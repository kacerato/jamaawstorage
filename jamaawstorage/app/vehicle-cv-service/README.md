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

## QR Code e calibração

O serviço já detecta QR Codes e devolve `qrPayload`. Para o QR melhorar a
geometria, o adesivo deve ficar em posição fixa junto ao painel. Uma calibração
por veículo registra a transformação entre os quatro cantos do QR e o display;
assim, fotos inclinadas podem ser retificadas antes da leitura. Sem calibração,
o QR identifica o veículo, mas não deve ser usado como falsa promessa de
precisão.
