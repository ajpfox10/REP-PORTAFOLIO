"""
Acceso a la casilla de antecedentes penales (recepciondeantecedentesrrhhkm@gmail.com) por la API de Gmail.

La primera vez hay que autorizar a mano (abre el navegador, se entra con la cuenta y se acepta):
  python gmail_antecedentes.py
Eso deja gmail_antecedentes_token.json; despues los robots entran solos con ese token.
"""
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

AQUI = Path(__file__).resolve().parent
CREDENCIALES = AQUI / "gmail_antecedentes_credentials.json"   # cliente OAuth (App de escritorio)
TOKEN = AQUI / "gmail_antecedentes_token.json"
# modify = leer + etiquetar (marcar "Procesado"); no permite borrar definitivamente
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


def credenciales(interactivo=False):
    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    elif interactivo:
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENCIALES), SCOPES)
        creds = flow.run_local_server(port=0, open_browser=True,
                                      authorization_prompt_message="Abri este link si no se abrio solo el navegador:\n{url}\n")
    else:
        raise RuntimeError("Gmail antecedentes sin autorizar: correr 'python gmail_antecedentes.py' y aceptar en el navegador")
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    return creds


def servicio(interactivo=False):
    return build("gmail", "v1", credentials=credenciales(interactivo), cache_discovery=False)


if __name__ == "__main__":
    svc = servicio(interactivo=True)
    perfil = svc.users().getProfile(userId="me").execute()
    print(f"OK: autorizado como {perfil['emailAddress']} ({perfil.get('messagesTotal', '?')} mensajes)")
    sys.exit(0)
