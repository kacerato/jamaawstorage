# Jamaaw Vehicle CV

Serviço Python de visão computacional para leitura rápida do painel Shineray
TLux T30 2025. O caminho normal usa OpenCV e regras determinísticas; nenhuma IA
generativa é necessária quando ODO e barras são reconhecidos com confiança.

## Desenvolvimento

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Teste local de uma foto:

```powershell
curl.exe -F "file=@C:\caminho\painel.jpg" http://localhost:8000/v1/analyze/upload
```

## Configuração

- `ALLOWED_IMAGE_HOSTS`: hosts HTTPS autorizados, separados por vírgula. Em
  produção, configure exatamente o host do Supabase Storage.
- `CORS_ORIGINS`: origens web autorizadas, separadas por vírgula. O proxy da
  Vercel não precisa de CORS.
- `VEHICLE_CV_SERVICE_TOKEN`: segredo compartilhado. Quando configurado, os
  endpoints de análise e marcador exigem `Authorization: Bearer <token>`.
- `MAX_IMAGE_BYTES`: limite de download; padrão de 12 MB.

## Deploy

O diretório inclui `render.yaml`, `railway.toml` e `Dockerfile`. No app Vercel,
configure `VEHICLE_CV_SERVICE_URL` com a URL pública, sem barra final.

O plano gratuito do Render é adequado para calibração, mas pode dormir. Para
latência previsível, use uma instância sempre ativa (Render pago, Railway ou
outro host Docker). O código não depende do provedor.

## Medição da leitura

O conjunto rotulado vive em `fixtures/`: a foto de campo mais o valor
verdadeiro (ODO 425, 6/8 barras). `scripts/make_dataset.py` gera a partir dela
as condições que o celular produz no pátio — inclinação, perspectiva,
exposição, gamma, sombra, reflexo, desfoque, ruído e escala — e
`scripts/evaluate.py` mede o resultado em três números separados:

```powershell
.venv\Scripts\python scripts\make_dataset.py fixtures\dashboard-t30.jpg --out out\variants --odo 425 --bars 6
.venv\Scripts\python scripts\evaluate.py out\variants --labels out\variants\labels.json
```

- **acerto** — leu e acertou
- **abstenção** — não leu; o operador digita e nada quebra
- **ERRO** — leu e errou com `needsReview: false`; é o único caro, porque
  entra no histórico do veículo como se fosse verdade

`evaluate.py` sai com código 1 se houver qualquer erro silencioso. Em 36
variações a leitura está hoje em 0 erro silencioso, com 41,7% de acerto no
ODO e 61,1% no combustível; o resto abstém. Preferir abster a errar é
deliberado: o fallback visual na Vercel cobre a abstenção.

## QR Code e calibração

O serviço já detecta QR Codes e devolve `qrPayload`. Para o QR melhorar a
geometria, o adesivo deve ficar em posição fixa junto ao painel. Uma calibração
por veículo registra a transformação entre os quatro cantos do QR e o display;
assim, fotos inclinadas podem ser retificadas antes da leitura. Sem calibração,
o QR identifica o veículo, mas não deve ser usado como falsa promessa de
precisão.
