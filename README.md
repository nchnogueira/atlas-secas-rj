# Atlas Histórico de Secas e Risco Hídrico do Estado do Rio de Janeiro (1981–2025)

Aplicação web estática e pipeline científico para monitoramento multiescalar de secas e cheias no Estado do Rio de Janeiro, integrando matrizes espaciais do **CHIRPS v3** e **ERA5-Land**, modelagem autorregressiva **ARIMA** e visualização em alta resolução.

---

## Estrutura do Projeto

```text
Atlas_Secas_RJ/
├── web/                           # Aplicação web estática completa
│   ├── index.html                 # Interface principal e documentação metodológica
│   ├── css/
│   │   └── styles.css             # Folha de estilos e paleta RdBu
│   ├── js/
│   │   ├── app.js                 # Controlador da aplicação
│   │   ├── map.js                 # Motor Leaflet + Canvas e camadas vetoriais
│   │   └── chart.js               # Gráficos dinâmicos com Apache ECharts
│   └── data/                      # Matrizes e camadas de alta resolução
│       ├── grid_meta.json         # Metadados dos 1.746 pixels (~5,5 km)
│       ├── dates.json             # 540 meses históricos + 3 de projeção
│       ├── muni_bounds.geojson    # Contornos dos 92 municípios do RJ (IBGE)
│       ├── state_bounds.geojson   # Limites do RJ, SP, MG e ES
│       ├── spei_3.json            # Matriz multiescalar SPEI-3
│       ├── spei_6.json            # Matriz multiescalar SPEI-6
│       ├── spei_12.json           # Matriz multiescalar SPEI-12
│       ├── spei_24.json           # Matriz multiescalar SPEI-24
│       └── forecast.json          # Projeções ARIMA (h=3), IC 80% e 95%
├── scripts/                       # Pipelines reprodutíveis em R
│   ├── generate_atlas_dataset.R   # Ingestão DuckDB, cálculo de SPEI e ARIMA
│   └── export_high_res_shapes.R   # Extração dos vetores de alta resolução
├── PLANO_PROJETO.md               # Planejamento metodológico detalhado
└── README.md                      # Instruções de execução e documentação
```

---

## Como Atualizar os Dados do Projeto

Sempre que novas observações forem inseridas nos bancos DuckDB do CHIRPS v3 e ERA5-Land (adicionando novos meses ou retificando dados históricos):

1. **Atualização em 1 clique (Windows):**
   * Dê um duplo clique no arquivo [`atualizar_dados.bat`](file:///c:/Users/nchnogueira/Documents/GitHub/atlas-secas-rj/atualizar_dados.bat) na raiz do repositório.
   * Ou no PowerShell:
     ```powershell
     .\atualizar_dados.bat
     ```

2. **O que o script executa automaticamente:**
   * Executa o pipeline científico em R (`scripts/generate_atlas_dataset.R`).
   * Recalcula os índices multiescalares ($D = P - \text{PET}$, SPEI-3, SPEI-6, SPEI-12, SPEI-24).
   * Reajusta o modelo autorregressivo ARIMA para os pixels e municípios, projetando os próximos meses com intervalos de confiança de 80% e 95%.
   * Gera as matrizes JSON otimizadas em `web/data/`.
   * Sincroniza automaticamente toda a aplicação para a pasta de publicação `docs/atlas-secas-rj/` (GitHub Pages).

---

## Como Executar a Aplicação Web Localmente

Como a aplicação realiza requisições assíncronas locais para carregar os dados das matrizes e contornos vetoriais, utilize um servidor estático:

### Via Script Automático:
Dê um duplo clique no arquivo [`rodar_site.bat`](file:///c:/Users/nchnogueira/Documents/GitHub/atlas-secas-rj/rodar_site.bat). O servidor local será iniciado e a página aberta automaticamente no seu navegador.

### Via Python:
Acesse a pasta do repositório no terminal e execute:
```powershell
python -m http.server 8088 --directory web
```
Depois, abra no navegador:
**[http://localhost:8088](http://localhost:8088)**

### Via VS Code:
Abra o arquivo `web/index.html` e selecione **"Open with Live Server"**.

---

## Como Reexecutar os Scripts Científicos em R

Os scripts utilizam os dados do mestrado armazenados em DuckDB e pacotes como `SPEI`, `forecast`, `sf`, `geobr` e `duckdb`.

Para rodar a extração dos vetores em alta resolução:
```powershell
Rscript scripts/export_high_res_shapes.R
```

Para recalcular o SPEI e as projeções ARIMA:
```powershell
Rscript scripts/generate_atlas_dataset.R
```

---

## Uso de Inteligência Artificial e Responsabilidade Técnica

Este projeto contou com o apoio de ferramentas de **Inteligência Artificial (modelos de linguagem / LLMs)** como recurso auxiliar para aceleração do desenvolvimento de código (estruturação de scripts em linguagem R, engenharia da interface web estática e organização da documentação técnica).

A concepção teórica, definição do problema, formulação metodológica, harmonização espacial dos dados de satélite e reanálise meteorológica (**CHIRPS v3** e **ERA5-Land**), parametrização matemática ($D = P - \text{PET}$, L-momentos e distribuições de probabilidades), modelagem preditiva estocástica ARIMA e interpretação das vulnerabilidades climáticas e hídricas fluminenses foram idealizadas, projetadas e conduzidas integralmente pelo autor.

> **Declaração de Responsabilidade:** O autor (**Nícolas Chenquel Nogueira**) auditou, testou e validou todo o código-fonte, rotinas analíticas, matrizes de dados e interpretações científicas, **assumindo inteira e irrestrita responsabilidade** por todo o conteúdo, resultados e conclusões apresentados neste projeto.

---

## Autoria e Contato

* **Autor:** [Nícolas Chenquel Nogueira](https://github.com/nchnogueira)
* **Vínculo Institucional:** Mestrando em Ciências Naturais na Universidade Estadual do Norte Fluminense Darcy Ribeiro (UENF) &middot; Licenciado em Ciências Biológicas pela UFRJ
* **Áreas de Atuação:** Climatologia Quantitativa, Modelagem de Risco Hídrico, Bioestatística, Geoprocessamento e Risco Climático Corporativo (ESG/TCFD)
* **Licença:** MIT (consulte o arquivo [LICENSE](file:///c:/Users/nchnogueira/Documents/GitHub/atlas-secas-rj/LICENSE) para mais detalhes)
