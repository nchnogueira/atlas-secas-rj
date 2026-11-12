suppressPackageStartupMessages({
  library(sf)
  library(geobr)
})

cat("Carregando municipios do RJ em ALTA RESOLUCAO...\n")
mun <- read_municipality(code_muni = "RJ", year = 2020, showProgress = FALSE)
mun <- st_transform(mun, 4326)

# Salvar sem decimação
st_write(
  mun[, c("code_muni", "name_muni")], 
  "docs/atlas-secas-rj/data/muni_bounds.geojson", 
  delete_dsn = TRUE, 
  quiet = TRUE
)
cat(sprintf("muni_bounds.geojson salvo: %.1f KB\n", file.info("docs/atlas-secas-rj/data/muni_bounds.geojson")$size / 1024))

cat("Carregando estados do Brasil...\n")
tryCatch({
  states <- read_state(year = 2020, showProgress = FALSE)
  states <- st_transform(states, 4326)
  states_se <- states[states$code_state %in% c(33, 31, 35, 32), ]
  st_write(
    states_se[, c("code_state", "name_state", "abbrev_state")], 
    "docs/atlas-secas-rj/data/state_bounds.geojson", 
    delete_dsn = TRUE, 
    quiet = TRUE
  )
  cat(sprintf("state_bounds.geojson salvo: %.1f KB\n", file.info("docs/atlas-secas-rj/data/state_bounds.geojson")$size / 1024))
}, error = function(e) {
  cat("Erro ao carregar estados:", conditionMessage(e), "\n")
})
