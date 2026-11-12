# ==============================================================================
# PIPELINE ATUALIZADO: ATLAS DE SECAS DO RIO DE JANEIRO (CHIRPS v3 + ERA5-Land)
# Período Observado: 1981-01 a 2026-09 (549 meses) + Forecast ARIMA h=12 (2026-10 a 2027-09)
# ==============================================================================

cat("\n==============================================================================\n")
cat("  PROCESSAMENTO COMPLETO DO ATLAS DE SECAS RJ (COM DADOS OBSERVADOS DE 2026)  \n")
cat("==============================================================================\n\n")

t_start <- Sys.time()

suppressPackageStartupMessages({
  library(duckdb)
  library(DBI)
  library(sf)
  library(geobr)
  library(dplyr)
  library(tidyr)
  library(jsonlite)
  library(parallel)
  library(SPEI)
  library(forecast)
})

DB_CHIRPS <- "C:/Users/nchnogueira/Documents/GitHub/Mestrado/data/db/chirps_rj.duckdb"
DB_ERA5   <- "C:/Users/nchnogueira/Documents/GitHub/Mestrado/data/db/era5land_rj.duckdb"
WEB_DIR   <- "C:/Users/nchnogueira/Documents/GitHub/Portifolio/Atlas_Secas_RJ/web/data"
DOCS_DIR  <- "C:/Users/nchnogueira/Documents/GitHub/Portifolio/docs/atlas-secas-rj/data"

dir.create(WEB_DIR, recursive = TRUE, showWarnings = FALSE)
dir.create(DOCS_DIR, recursive = TRUE, showWarnings = FALSE)

# ------------------------------------------------------------------------------
# 1. CARREGAR MALHA MUNICIPAL
# ------------------------------------------------------------------------------
cat("[1/6] Carregando malha municipal do RJ (geobr)...\n")
mun <- read_municipality(code_muni = "RJ", year = 2020, showProgress = FALSE)
mun <- st_transform(mun, 4326)

mun_simple <- st_simplify(mun, dTolerance = 0.003)
st_write(
  mun_simple[, c("code_muni", "name_muni")], 
  file.path(WEB_DIR, "muni_bounds.geojson"), 
  delete_dsn = TRUE, 
  quiet = TRUE
)
st_write(
  mun_simple[, c("code_muni", "name_muni")], 
  file.path(DOCS_DIR, "muni_bounds.geojson"), 
  delete_dsn = TRUE, 
  quiet = TRUE
)
cat("  -> muni_bounds.geojson gerado com sucesso.\n")

# ------------------------------------------------------------------------------
# 2. CARREGAR PRECIPITAÇÃO E TEMPERATURA DO DUCKDB
# ------------------------------------------------------------------------------
cat("\n[2/6] Conectando ao DuckDB e extraindo series historicas...\n")
con_c <- dbConnect(duckdb(), DB_CHIRPS, read_only = TRUE)
con_e <- dbConnect(duckdb(), DB_ERA5, read_only = TRUE)

# Todos os pixels ordenados
pixels_chirps <- dbGetQuery(con_c, "
  SELECT DISTINCT lon, lat 
  FROM prec_mensal_pixel 
  ORDER BY lon, lat
")
pixels_chirps$pixel_id <- 0:(nrow(pixels_chirps) - 1)
n_pixels <- nrow(pixels_chirps)
cat(sprintf("  -> Total de pixels monitorados: %d\n", n_pixels))

# Associação com municípios
pts_sf <- st_as_sf(pixels_chirps, coords = c("lon", "lat"), crs = 4326, remove = FALSE)
joined_mun <- st_join(pts_sf, mun[, c("code_muni", "name_muni")])
na_mun_idx <- which(is.na(joined_mun$name_muni))
if (length(na_mun_idx) > 0) {
  nearest_idx <- st_nearest_feature(pts_sf[na_mun_idx, ], mun)
  joined_mun$code_muni[na_mun_idx] <- mun$code_muni[nearest_idx]
  joined_mun$name_muni[na_mun_idx] <- mun$name_muni[nearest_idx]
}
pixels_chirps$code_muni <- as.character(joined_mun$code_muni)
pixels_chirps$name_muni <- as.character(joined_mun$name_muni)

# Matriz de precipitação (n_pixels x n_meses)
cat("  -> Carregando matriz de precipitacao mensal (CHIRPS v3)...\n")
prec_raw <- dbGetQuery(con_c, "
  SELECT lon, lat, data_mes, prec_mensal 
  FROM prec_mensal_pixel 
  ORDER BY lon, lat, data_mes
")
dbDisconnect(con_c, shutdown = TRUE)

datas_unicas <- sort(unique(prec_raw$data_mes))
n_meses <- length(datas_unicas)
datas_str <- format(as.Date(datas_unicas), "%Y-%m")
cat(sprintf("  -> Periodo de dados observados: %s a %s (%d meses)\n", datas_str[1], datas_str[n_meses], n_meses))

prec_matrix <- matrix(prec_raw$prec_mensal, nrow = n_pixels, ncol = n_meses, byrow = TRUE)

# Matriz de temperatura do ERA5-Land
cat("  -> Carregando matriz de temperatura do ERA5-Land...\n")
temp_raw <- dbGetQuery(con_e, "
  SELECT lon, lat, ano, mes, temp_media_mensal 
  FROM era5_mensal 
  WHERE ano >= 1981
  ORDER BY lon, lat, ano, mes
")
dbDisconnect(con_e, shutdown = TRUE)

era_pixels <- temp_raw %>% select(lon, lat) %>% distinct() %>% arrange(lon, lat)
era_pixels$era_id <- 1:nrow(era_pixels)

# Cruzar coordenadas para mapear pixel CHIRPS -> pixel ERA5 mais próximo
c_coords <- as.matrix(pixels_chirps[, c("lon", "lat")])
e_coords <- as.matrix(era_pixels[, c("lon", "lat")])
nearest_era_idx <- apply(c_coords, 1, function(pt) {
  dists <- (e_coords[, 1] - pt[1])^2 + (e_coords[, 2] - pt[2])^2
  which.min(dists)
})
pixels_chirps$era_id <- era_pixels$era_id[nearest_era_idx]

# Estruturar matriz de temperatura garantindo cobertura de todos os n_meses
cat("  -> Harmonizando grade termica para todos os meses observados...\n")
datas_dt <- as.Date(datas_unicas)
target_anos <- as.integer(format(datas_dt, "%Y"))
target_meses <- as.integer(format(datas_dt, "%m"))

# Para cada pixel ERA5, construir o vetor exato de n_meses completando eventuais meses com média climatológica
era_list <- split(temp_raw, list(temp_raw$lon, temp_raw$lat), drop = TRUE)
n_era <- length(era_pixels$era_id)

temp_matrix_by_era <- matrix(NA_real_, nrow = n_era, ncol = n_meses)

for (k in 1:n_era) {
  p_lon <- era_pixels$lon[k]
  p_lat <- era_pixels$lat[k]
  sub_df <- temp_raw %>% filter(lon == p_lon, lat == p_lat)
  
  # Médias climatológicas por mês do pixel (1 a 12)
  clim_means <- sub_df %>% group_by(mes) %>% summarise(m = mean(temp_media_mensal, na.rm = TRUE), .groups = "drop")
  clim_vec <- setNames(clim_means$m, clim_means$mes)
  
  # Preencher cada um dos n_meses
  t_row <- numeric(n_meses)
  for (m_idx in 1:n_meses) {
    a <- target_anos[m_idx]
    m <- target_meses[m_idx]
    val <- sub_df$temp_media_mensal[sub_df$ano == a & sub_df$mes == m]
    if (length(val) > 0 && !is.na(val[1])) {
      t_row[m_idx] <- val[1]
    } else {
      t_row[m_idx] <- clim_vec[as.character(m)]
    }
  }
  temp_matrix_by_era[k, ] <- t_row
}
cat("  -> Matriz de temperatura harmonizada com sucesso!\n")

# ------------------------------------------------------------------------------
# 3. GERAR GRID_META E DATES.JSON
# ------------------------------------------------------------------------------
cat("\n[3/6] Gerando grid_meta.json e dates.json...\n")
muni_list <- list()
for (i in 1:nrow(mun)) {
  m <- mun[i, ]
  bb <- st_bbox(m)
  cnt <- st_coordinates(st_centroid(st_geometry(m)))[1, ]
  c_code <- as.character(m$code_muni)
  px_count <- sum(pixels_chirps$code_muni == c_code)
  
  muni_list[[c_code]] <- list(
    code = c_code,
    name = as.character(m$name_muni),
    bbox = round(as.numeric(c(bb$xmin, bb$ymin, bb$xmax, bb$ymax)), 4),
    center = round(as.numeric(c(cnt["X"], cnt["Y"])), 4),
    pixel_count = px_count
  )
}

grid_meta <- list(
  pixels = lapply(1:n_pixels, function(i) {
    list(
      id = pixels_chirps$pixel_id[i],
      lon = round(pixels_chirps$lon[i], 4),
      lat = round(pixels_chirps$lat[i], 4),
      muni_code = pixels_chirps$code_muni[i],
      muni_name = pixels_chirps$name_muni[i]
    )
  }),
  municipalities = muni_list
)
write_json(grid_meta, file.path(WEB_DIR, "grid_meta.json"), auto_unbox = TRUE)
write_json(grid_meta, file.path(DOCS_DIR, "grid_meta.json"), auto_unbox = TRUE)

# Horizon de Forecast de 12 meses a partir do último mês observado (2026-09)
# 2026-10 a 2027-09
fc_dates <- c(
  "2026-10", "2026-11", "2026-12",
  "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
  "2027-07", "2027-08", "2027-09"
)
datas_completo <- c(datas_str, fc_dates)
write_json(datas_completo, file.path(WEB_DIR, "dates.json"), auto_unbox = TRUE)
write_json(datas_completo, file.path(DOCS_DIR, "dates.json"), auto_unbox = TRUE)
cat(sprintf("  -> dates.json salvo: %d meses observados + 12 projetados = %d meses totais\n", n_meses, length(datas_completo)))

# ------------------------------------------------------------------------------
# 4. PROCESSAMENTO PARALELO DO SPEI (3, 6, 12, 24) E ARIMA (h=12)
# ------------------------------------------------------------------------------
cat("\n[4/6] Executando calculo do SPEI e ARIMA em paralelo (12 cores)...\n")

pixel_tasks <- vector("list", n_pixels)
for (i in 1:n_pixels) {
  era_idx <- pixels_chirps$era_id[i]
  pixel_tasks[[i]] <- list(
    id = pixels_chirps$pixel_id[i],
    lat = pixels_chirps$lat[i],
    prec = prec_matrix[i, ],
    temp = temp_matrix_by_era[era_idx, ]
  )
}

cores_usados <- min(12, detectCores())
cl <- makeCluster(cores_usados)

clusterEvalQ(cl, {
  suppressPackageStartupMessages({
    library(SPEI)
    library(forecast)
  })
  
  calc_spei_safe <- function(d_ts, scale) {
    tryCatch({
      invisible(capture.output({
        obj <- spei(d_ts, scale = scale, distribution = "log-Logistic", na.rm = TRUE)
      }))
      vals <- as.numeric(obj$fitted)
      vals <- pmax(pmin(vals, 4.5), -4.5)
      round(vals, 2)
    }, error = function(e) {
      rep(NA_real_, length(d_ts))
    })
  }
  
  calc_arima_12 <- function(series_vec) {
    valid_idx <- which(!is.na(series_vec))
    if (length(valid_idx) < 24) {
      return(list(
        mean = rep(0, 12),
        lo80 = rep(-1.28, 12),
        hi80 = rep(1.28, 12),
        lo95 = rep(-1.96, 12),
        hi95 = rep(1.96, 12)
      ))
    }
    
    clean_series <- series_vec[valid_idx]
    tryCatch({
      fit <- auto.arima(
        ts(clean_series, frequency = 12),
        max.p = 2,
        max.q = 2,
        seasonal = FALSE,
        stepwise = TRUE
      )
      fc <- forecast(fit, h = 12)
      list(
        mean = pmax(pmin(round(as.numeric(fc$mean), 2), 4.5), -4.5),
        lo80 = pmax(pmin(round(as.numeric(fc$lower[, 1]), 2), 4.5), -4.5),
        hi80 = pmax(pmin(round(as.numeric(fc$upper[, 1]), 2), 4.5), -4.5),
        lo95 = pmax(pmin(round(as.numeric(fc$lower[, 2]), 2), 4.5), -4.5),
        hi95 = pmax(pmin(round(as.numeric(fc$upper[, 2]), 2), 4.5), -4.5)
      )
    }, error = function(e) {
      last_val <- tail(clean_series, 1)
      list(
        mean = rep(round(last_val, 2), 12),
        lo80 = rep(round(last_val - 1.28, 2), 12),
        hi80 = rep(round(last_val + 1.28, 2), 12),
        lo95 = rep(round(last_val - 1.96, 2), 12),
        hi95 = rep(round(last_val + 1.96, 2), 12)
      )
    })
  }
})

cat(sprintf("  -> Processando pixels com %d workers...\n", cores_usados))
results_pixels <- parLapply(cl, pixel_tasks, function(task) {
  # 1. PET Thornthwaite
  t_ts <- ts(task$temp, start = c(1981, 1), frequency = 12)
  pet <- thornthwaite(t_ts, lat = task$lat)
  
  # 2. Balanço Hídrico
  d_bal <- task$prec - as.numeric(pet)
  d_ts <- ts(d_bal, start = c(1981, 1), frequency = 12)
  
  # 3. SPEI multiescalar
  spei_3  <- calc_spei_safe(d_ts, 3)
  spei_6  <- calc_spei_safe(d_ts, 6)
  spei_12 <- calc_spei_safe(d_ts, 12)
  spei_24 <- calc_spei_safe(d_ts, 24)
  
  # 4. Projeção ARIMA 12 meses futuros
  fc_3  <- calc_arima_12(spei_3)
  fc_6  <- calc_arima_12(spei_6)
  fc_12 <- calc_arima_12(spei_12)
  fc_24 <- calc_arima_12(spei_24)
  
  # 5. Extremos históricos em SPEI-12
  valid_12 <- spei_12
  min_val <- min(valid_12, na.rm = TRUE)
  min_idx <- which(valid_12 == min_val)[1]
  max_val <- max(valid_12, na.rm = TRUE)
  max_idx <- which(valid_12 == max_val)[1]
  
  list(
    id = task$id,
    spei = list("3" = spei_3, "6" = spei_6, "12" = spei_12, "24" = spei_24),
    forecast = list("3" = fc_3, "6" = fc_6, "12" = fc_12, "24" = fc_24),
    extremos = list(
      min_val = min_val, min_idx = min_idx - 1,
      max_val = max_val, max_idx = max_idx - 1
    )
  )
})
stopCluster(cl)
cat("  -> Processamento paralelo concluido com sucesso!\n")

# ------------------------------------------------------------------------------
# 5. AGREGAR MÉDIAS MUNICIPAIS
# ------------------------------------------------------------------------------
cat("\n[5/6] Agregando series municipais...\n")
muni_codes <- names(muni_list)
muni_data <- list()

for (c_code in muni_codes) {
  px_indices <- which(pixels_chirps$code_muni == c_code)
  if (length(px_indices) == 0) next
  
  muni_spei <- list()
  muni_fc <- list()
  
  for (sc in c("3", "6", "12", "24")) {
    mat_sc <- do.call(rbind, lapply(px_indices, function(idx) results_pixels[[idx]]$spei[[sc]]))
    mean_series <- round(colMeans(mat_sc, na.rm = TRUE), 2)
    muni_spei[[sc]] <- mean_series
    
    # Forecast na série municipal
    valid_vals <- mean_series[!is.na(mean_series)]
    fit <- auto.arima(ts(valid_vals, frequency = 12), max.p = 2, max.q = 2, seasonal = FALSE, stepwise = TRUE)
    fc <- forecast(fit, h = 12)
    muni_fc[[sc]] <- list(
      mean = pmax(pmin(round(as.numeric(fc$mean), 2), 4.5), -4.5),
      lo80 = pmax(pmin(round(as.numeric(fc$lower[, 1]), 2), 4.5), -4.5),
      hi80 = pmax(pmin(round(as.numeric(fc$upper[, 1]), 2), 4.5), -4.5),
      lo95 = pmax(pmin(round(as.numeric(fc$lower[, 2]), 2), 4.5), -4.5),
      hi95 = pmax(pmin(round(as.numeric(fc$upper[, 2]), 2), 4.5), -4.5)
    )
  }
  
  valid_12 <- na.omit(muni_spei[["12"]])
  min_val <- min(valid_12)
  min_idx <- which(muni_spei[["12"]] == min_val)[1]
  max_val <- max(valid_12)
  max_idx <- which(muni_spei[["12"]] == max_val)[1]
  
  muni_data[[c_code]] <- list(
    spei = muni_spei,
    forecast = muni_fc,
    extremos = list(
      min_val = min_val, min_idx = min_idx - 1,
      max_val = max_val, max_idx = max_idx - 1
    )
  )
}

# ------------------------------------------------------------------------------
# 6. EXPORTAR JSONS OTIMIZADOS
# ------------------------------------------------------------------------------
cat("\n[6/6] Exportando matrizes JSON para web e publicacao...\n")

for (sc in c("3", "6", "12", "24")) {
  cat(sprintf("  -> Exportando spei_%s.json...\n", sc))
  
  pixel_matrix <- lapply(results_pixels, function(res) {
    # Converte NA para NULL para que vire null no JSON
    vals <- res$spei[[sc]]
    # Anexa a projeção de forecast (12 meses) no final da matriz para o mapa renderizar texturizado
    fc_vals <- res$forecast[[sc]]$mean
    c(vals, fc_vals)
  })
  
  muni_dict <- lapply(muni_data, function(m) {
    c(m$spei[[sc]], m$forecast[[sc]]$mean)
  })
  
  payload <- list(
    scale = as.integer(sc),
    n_historical = n_meses,
    n_forecast = 12,
    pixels = pixel_matrix,
    municipalities = muni_dict
  )
  
  write_json(payload, file.path(WEB_DIR, sprintf("spei_%s.json", sc)), auto_unbox = TRUE, digits = 2)
  write_json(payload, file.path(DOCS_DIR, sprintf("spei_%s.json", sc)), auto_unbox = TRUE, digits = 2)
}

cat("  -> Exportando forecast.json...\n")
forecast_payload <- list(
  n_historical = n_meses,
  n_forecast = 12,
  pixels = lapply(results_pixels, function(res) {
    list(
      forecast = res$forecast,
      extremos = res$extremos
    )
  }),
  municipalities = lapply(muni_data, function(m) {
    list(
      forecast = m$forecast,
      extremos = m$extremos
    )
  })
)
write_json(forecast_payload, file.path(WEB_DIR, "forecast.json"), auto_unbox = TRUE, digits = 2)
write_json(forecast_payload, file.path(DOCS_DIR, "forecast.json"), auto_unbox = TRUE, digits = 2)

t_end <- Sys.time()
cat(sprintf("\n=== RECALCULO CONCLUIDO COM SUCESSO EM %.1f MINUTOS! ===\n", difftime(t_end, t_start, units = "mins")))
cat(sprintf("Dados abrangem de %s a %s (Observados) + 12 meses de projecao ARIMA.\n", datas_str[1], datas_str[n_meses]))
