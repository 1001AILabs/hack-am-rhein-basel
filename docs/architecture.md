# Basel Life Sciences Ecosystem Navigator — Architecture

## The Triangle

```
                    USER
          (voice or text, DE/FR/EN)
                     |
                     v
         +-----------------------+
         |     FRONTEND UI       |
         |  chat + plan display  |
         +-----------------------+
                     |
                     v
         +-----------------------+
         |     ELEVENLABS        |
         |  voice in + voice out |
         +-----------------------+
                     |
                     v
   +-------------------------------------+
   |         THE TRIANGLE                 |
   |                                      |
   |   [1] CODEX                          |
   |    - orchestration layer             |
   |    - agent reasoning                 |
   |    - tool-calling                    |
   |    - knowledge graph queries         |
   |                                      |
   |              |                       |
   |              v                       |
   |   [2] NVIDIA RAG BLUEPRINT           |
   |    - vector DB (pgvector)            |
   |    - retrieval pipeline              |
   |    - re-ranking                      |
   |    - knowledge graph traversal       |
   |    - 6 Basel data sources ingested   |
   |                                      |
   |              |                       |
   |              v                       |
   |   [3] APERTUS 1.5 (via API)          |
   |    - Swiss sovereign LLM             |
   |    - ETH Zurich / EPFL / CSCS        |
   |    - native DE / FR / IT / EN        |
   |    - final answer generation         |
   |    - personalized action plan        |
   +--------------------------------------+
```

## Data Sources (6)

| Source | What | How |
|---|---|---|
| Zefix | Swiss commercial register | REST API (live) |
| Basel Super Cluster | Life-sciences cluster members | Scrape + curation |
| BaseLaunch | Biotech accelerator portfolio | Scrape + docs |
| DayOne (Basel Area) | Healthtech innovation program | Scrape + docs |
| Startup.ch | Swiss investor directory | API or scrape |
| Switzerland Innovation Park Basel | Lab space, equipment | Docs + manual |

## Agent Tools (7)

| Tool | Input | Output |
|---|---|---|
| `search_labs(discipline, location)` | "oncology, Basel" | Lab list with capacity, contact |
| `search_investors(stage, sector, ticket_size)` | "seed, biotech, CHF 500K-2M" | Ranked investor list |
| `search_programs(stage, sector)` | "pre-seed, healthtech" | Program matches |
| `search_companies(sector, size, zefix_filter)` | "biotech, <50 employees" | Zefix results |
| `graph_traverse(entity, relation, depth)` | "BaseLaunch, portfolio, 2" | Related entities |
| `generate_action_plan(user_profile)` | Full profile | 90-day plan |
| `voice_response(text, lang)` | Text + lang | ElevenLabs audio URL |

## Demo Scenario

Oncology researcher asks in French:
> "Je suis chercheuse en oncologie à l'Université de Bâle, je veux créer une startup. Qu'est-ce que je dois faire?"

System returns:
1. Visual map of connections (lab → program → investor)
2. 5 named contacts with emails
3. 3 funding deadlines
4. 1 lab space available next month
5. ElevenLabs reads back the plan in French

## Task Split

- **Alaa:** backend, RAG, Apertus wiring, Zefix connector, 7 agent tools
- **Reazul:** knowledge graph schema + ingestion, UI (chat + plan + graph viz)
- **Leticia:** ElevenLabs voice in/out, UI polish
- **Trudy:** demo script, pitch slides, rehearsal
- **Daria:** data curation for 5 scrape sources, demo script
