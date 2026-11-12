# ==============================================================================
# PROJEÇÃO ARIMA 24 MESES (JAN/2026 A DEZ/2027) - EXPORTAÇÃO INTERMEDIÁRIA
# ==============================================================================

cat("Iniciando calculo do forecast ARIMA h=24...\n")
t_start <- Sys.time()

suppressPackageStartupMessages({
  library(jsonlite)
  library(forecast)
  library(parallel)
})

WEB_DATA_DIR <- "c:/Users/nchnogueira/Documents/GitHub/Portifolio/Atlas_Secas_RJ/web/data"

cat("Carregando matrizes atuais...\n")
spei_3_data  <- fromJSON(file.path(WEB_DATA_DIR, "spei_3.json"))
spei_6_data  <- fromJSON(file.path(WEB_DATA_DIR, "spei_6.json"))
spei_12_data <- fromJSON(file.path(WEB_DATA_DIR, "spei_12.json"))
spei_24_data <- fromJSON(file.path(WEB_DATA_DIR, "spei_24.json"))

to_mat <- function(p) {
  if (is.matrix(p)) return(p)
  do.call(rbind, p)
}

mat_s3  <- to_mat(spei_3_data$pixels)[, 1:540]
mat_s6  <- to_mat(spei_6_data$pixels)[, 1:540]
mat_s12 <- to_mat(spei_12_data$pixels)[, 1:540]
mat_s24 <- to_mat(spei_24_data$pixels)[, 1:540]

n_pixels <- nrow(mat_s12)
cat(sprintf("Total de pixels a projetar: %d\n", n_pixels))

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
cat("Calculo concluido. Gravando temp_fc_24m.json...\n")

temp_out <- list(
  pixels = pixel_forecasts,
  municipalities = muni_forecasts
)

write_json(temp_out, "Atlas_Secas_RJ/scripts/temp_fc_24m.json", auto_unbox = TRUE, digits = 2)

t_end <- Sys.time()
cat(sprintf("Concluido em %.1f segundos!\n", as.numeric(difftime(t_end, t_start, units = "secs"))))
