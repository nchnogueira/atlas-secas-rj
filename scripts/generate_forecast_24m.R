# ==============================================================================
# PROJEÇÃO ARIMA 24 MESES (JAN/2026 A DEZ/2027) PARA O ATLAS DE SECAS DO RJ
# ==============================================================================

cat("Iniciando calculo do forecast ARIMA h=24 para todos os pixels e municipios...\n")
t_start <- Sys.time()

suppressPackageStartupMessages({
  library(jsonlite)
  library(forecast)
  library(parallel)
})

WEB_DATA_DIR <- "c:/Users/nchnogueira/Documents/GitHub/Portifolio/Atlas_Secas_RJ/web/data"
DOCS_DATA_DIR <- "c:/Users/nchnogueira/Documents/GitHub/Portifolio/docs/atlas-secas-rj/data"

# 1. Gerar vetor de 564 datas (540 históricas + 24 de previsão)
dates_hist <- fromJSON(file.path(WEB_DATA_DIR, "dates.json"))[1:540]
dates_fc <- c(
  sprintf("2026-%02d", 1:12),
  sprintf("2027-%02d", 1:12)
)
dates_564 <- c(dates_hist, dates_fc)
cat(sprintf("Datas configuradas: %d datas (Historico ate %s, Previsao de %s a %s)\n",
            length(dates_564), tail(dates_hist, 1), dates_fc[1], tail(dates_fc, 1)))

# 2. Carregar dados atuais
cat("Carregando matrizes atuais...\n")
spei_3_data  <- fromJSON(file.path(WEB_DATA_DIR, "spei_3.json"))
spei_6_data  <- fromJSON(file.path(WEB_DATA_DIR, "spei_6.json"))
spei_12_data <- fromJSON(file.path(WEB_DATA_DIR, "spei_12.json"))
spei_24_data <- fromJSON(file.path(WEB_DATA_DIR, "spei_24.json"))
forecast_old <- fromJSON(file.path(WEB_DATA_DIR, "forecast.json"))

# Converter pixels para matrizes se necessário
to_mat <- function(p) {
  if (is.matrix(p)) return(p)
  do.call(rbind, p)
}

mat_s3  <- to_mat(spei_3_data$pixels)[, 1:540]
mat_s6  <- to_mat(spei_6_data$pixels)[, 1:540]
mat_s12 <- to_mat(spei_12_data$pixels)[, 1:540]
mat_s24 <- to_mat(spei_24_data$pixels)[, 1:540]

n_pixels <- nrow(mat_s12)
cat(sprintf("Total de pixels a projetar: %d (540 meses observados)\n", n_pixels))

# Função para ajustar ARIMA e projetar h=24
fit_and_forecast_24 <- function(series_vec) {
  valid_idx <- which(!is.na(series_vec))
  if (length(valid_idx) < 24) {
    return(list(
      mean = rep(0, 24),
      lo80 = rep(-1.28, 24),
      hi80 = rep(1.28, 24),
      lo95 = rep(-1.96, 24),
      hi95 = rep(1.96, 24)
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
    fc <- forecast(fit, h = 24)
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
      mean = rep(round(last_val, 2), 24),
      lo80 = rep(round(last_val - 1.28, 2), 24),
      hi80 = rep(round(last_val + 1.28, 2), 24),
      lo95 = rep(round(last_val - 1.96, 2), 24),
      hi95 = rep(round(last_val + 1.96, 2), 24)
    )
  })
}

# 3. Processamento em paralelo dos 1.746 pixels
n_cores <- max(1, detectCores() - 1)
cat(sprintf("Configurando cluster paralelo com %d nucleos...\n", n_cores))
cl <- makeCluster(n_cores)
clusterExport(cl, c("fit_and_forecast_24"))
clusterEvalQ(cl, { library(forecast) })

cat("Calculando projecoes ARIMA 24m para cada pixel e escala...\n")
pixel_tasks <- lapply(1:n_pixels, function(i) {
  list(
    s3  = mat_s3[i, ],
    s6  = mat_s6[i, ],
    s12 = mat_s12[i, ],
    s24 = mat_s24[i, ]
  )
})

pixel_forecasts <- parLapply(cl, pixel_tasks, function(task) {
  list(
    "3"  = fit_and_forecast_24(task$s3),
    "6"  = fit_and_forecast_24(task$s6),
    "12" = fit_and_forecast_24(task$s12),
    "24" = fit_and_forecast_24(task$s24)
  )
})

cat("Calculando projecoes ARIMA 24m para os municipios...\n")
muni_codes <- names(spei_12_data$municipalities)
muni_tasks <- lapply(muni_codes, function(code) {
  list(
    code = code,
    s3  = as.numeric(spei_3_data$municipalities[[code]])[1:540],
    s6  = as.numeric(spei_6_data$municipalities[[code]])[1:540],
    s12 = as.numeric(spei_12_data$municipalities[[code]])[1:540],
    s24 = as.numeric(spei_24_data$municipalities[[code]])[1:540]
  )
})

muni_forecasts <- parLapply(cl, muni_tasks, function(task) {
  list(
    code = task$code,
    "3"  = fit_and_forecast_24(task$s3),
    "6"  = fit_and_forecast_24(task$s6),
    "12" = fit_and_forecast_24(task$s12),
    "24" = fit_and_forecast_24(task$s24)
  )
})

stopCluster(cl)
cat("Calculo do ARIMA concluido com sucesso!\n")

# 4. Montar novas matrizes de SPEI com os 24 meses estendidos (564 meses totais)
cat("Montando matrizes estendidas com 564 meses...\n")
extend_scale_data <- function(hist_mat, muni_raw, sc_key) {
  # Matriz de pixels estendida
  fc_mat <- do.call(rbind, lapply(1:n_pixels, function(i) {
    pixel_forecasts[[i]][[sc_key]]$mean
  }))
  new_pixel_mat <- cbind(hist_mat, fc_mat)
  
  # Municípios
  new_munis <- list()
  for (mf in muni_forecasts) {
    code <- mf$code
    hist_vals <- as.numeric(muni_raw[[code]])[1:540]
    fc_vals   <- mf[[sc_key]]$mean
    new_munis[[code]] <- c(hist_vals, fc_vals)
  }
  
  list(
    scale = as.integer(sc_key),
    pixels = new_pixel_mat,
    municipalities = new_munis
  )
}

new_spei_3  <- extend_scale_data(mat_s3,  spei_3_data$municipalities,  "3")
new_spei_6  <- extend_scale_data(mat_s6,  spei_6_data$municipalities,  "6")
new_spei_12 <- extend_scale_data(mat_s12, spei_12_data$municipalities, "12")
new_spei_24 <- extend_scale_data(mat_s24, spei_24_data$municipalities, "24")

# 5. Montar novo forecast.json com horizonte h=24
new_forecast_pixels <- lapply(1:n_pixels, function(i) {
  list(
    forecast = pixel_forecasts[[i]],
    trend    = forecast_old$pixels[[i]]$trend,
    extremos = forecast_old$pixels[[i]]$extremos
  )
})

new_forecast_munis <- list()
for (i in seq_along(muni_codes)) {
  code <- muni_codes[i]
  new_forecast_munis[[code]] <- list(
    forecast = list(
      "3"  = muni_forecasts[[i]][["3"]],
      "6"  = muni_forecasts[[i]][["6"]],
      "12" = muni_forecasts[[i]][["12"]],
      "24" = muni_forecasts[[i]][["24"]]
    ),
    trend    = forecast_old$municipalities[[code]]$trend,
    extremos = forecast_old$municipalities[[code]]$extremos
  )
}

new_forecast_payload <- list(
  pixels = new_forecast_pixels,
  municipalities = new_forecast_munis
)

# 6. Salvar todos os arquivos em WEB_DATA_DIR e DOCS_DATA_DIR
save_data_all <- function(dir_path) {
  cat(sprintf("Gravando arquivos JSON em %s...\n", dir_path))
  write_json(dates_564, file.path(dir_path, "dates.json"), auto_unbox = TRUE)
  write_json(new_spei_3, file.path(dir_path, "spei_3.json"), auto_unbox = TRUE, digits = 2)
  write_json(new_spei_6, file.path(dir_path, "spei_6.json"), auto_unbox = TRUE, digits = 2)
  write_json(new_spei_12, file.path(dir_path, "spei_12.json"), auto_unbox = TRUE, digits = 2)
  write_json(new_spei_24, file.path(dir_path, "spei_24.json"), auto_unbox = TRUE, digits = 2)
  write_json(new_forecast_payload, file.path(dir_path, "forecast.json"), auto_unbox = TRUE, digits = 2)
}

save_data_all(WEB_DATA_DIR)
save_data_all(DOCS_DATA_DIR)

t_end <- Sys.time()
cat(sprintf("\n=== FORECAST ARIMA 24 MESES FINALIZADO EM %.1f SEGUNDOS! ===\n", as.numeric(difftime(t_end, t_start, units = "secs"))))
