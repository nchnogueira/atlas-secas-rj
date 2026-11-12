import json
import os
import shutil

WEB_DATA = "c:/Users/nchnogueira/Documents/GitHub/Portifolio/Atlas_Secas_RJ/web/data"
DOCS_DATA = "c:/Users/nchnogueira/Documents/GitHub/Portifolio/docs/atlas-secas-rj/data"
TEMP_FC = "c:/Users/nchnogueira/Documents/GitHub/Portifolio/Atlas_Secas_RJ/scripts/temp_fc_24m.json"

print("Iniciando mesclagem dos forecasts de 24 meses...")

with open(TEMP_FC, "r", encoding="utf-8") as f:
    fc_temp = json.load(f)

# 1. Datas (540 históricas + 24 de previsão)
with open(os.path.join(WEB_DATA, "dates.json"), "r", encoding="utf-8") as f:
    dates_hist = json.load(f)[:540]

dates_24m = [f"2026-{m:02d}" for m in range(1, 13)] + [f"2027-{m:02d}" for m in range(1, 13)]
dates_564 = dates_hist + dates_24m
print(f"Total de datas: {len(dates_564)} ({dates_564[0]} a {dates_564[-1]})")

# 2. Atualizar forecast.json
with open(os.path.join(WEB_DATA, "forecast.json"), "r", encoding="utf-8") as f:
    fc_data = json.load(f)

# Substituir previsões de 3 meses por 24 meses nos pixels
for i, px_fc in enumerate(fc_temp["pixels"]):
    fc_data["pixels"][i]["forecast"] = px_fc

# Substituir previsões nos municípios
for item in fc_temp["municipalities"]:
    code = item["code"]
    if code in fc_data["municipalities"]:
        fc_data["municipalities"][code]["forecast"] = {
            "3": item["3"],
            "6": item["6"],
            "12": item["12"],
            "24": item["24"]
        }

print("forecast.json atualizado com sucesso!")

# 3. Atualizar spei_*.json estendendo cada série de 540 para 564 meses
for sc in ["3", "6", "12", "24"]:
    fname = f"spei_{sc}.json"
    with open(os.path.join(WEB_DATA, fname), "r", encoding="utf-8") as f:
        spei_payload = json.load(f)
    
    # Pixels
    for i in range(len(spei_payload["pixels"])):
        hist = spei_payload["pixels"][i][:540]
        fc_mean = fc_temp["pixels"][i][sc]["mean"]
        spei_payload["pixels"][i] = hist + fc_mean
    
    # Municípios
    for item in fc_temp["municipalities"]:
        code = item["code"]
        if code in spei_payload["municipalities"]:
            hist = spei_payload["municipalities"][code][:540]
            fc_mean = item[sc]["mean"]
            spei_payload["municipalities"][code] = hist + fc_mean
            
    # Salvar em WEB_DATA
    with open(os.path.join(WEB_DATA, fname), "w", encoding="utf-8") as f:
        json.dump(spei_payload, f, separators=(',', ':'))
    
    # Copiar para DOCS_DATA
    shutil.copy2(os.path.join(WEB_DATA, fname), os.path.join(DOCS_DATA, fname))
    print(f"{fname} estendido para 564 meses e sincronizado!")

# Salvar dates.json e forecast.json
for out_dir in [WEB_DATA, DOCS_DATA]:
    with open(os.path.join(out_dir, "dates.json"), "w", encoding="utf-8") as f:
        json.dump(dates_564, f, separators=(',', ':'))
    with open(os.path.join(out_dir, "forecast.json"), "w", encoding="utf-8") as f:
        json.dump(fc_data, f, separators=(',', ':'))

print("Mesclagem e sincronizacao de dados de 24 meses concluidas com 100% de sucesso!")
