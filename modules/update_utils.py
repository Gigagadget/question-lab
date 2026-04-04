"""
Utility per l'auto-aggiornamento dell'applicazione da GitHub.
Confronta la versione locale con i tag semver su GitHub e applica aggiornamenti.
"""

import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple

import requests


# Costanti
BASE_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = BASE_DIR / "version.json"
CONFIG_FILE = BASE_DIR / "config.json"
UPDATE_LOG_FILE = BASE_DIR / "update_log.json"


def load_json(filepath: Path) -> dict:
    """Carica un file JSON."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(filepath: Path, data: dict) -> None:
    """Salva un file JSON."""
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_local_version() -> str:
    """Restituisce la versione locale da version.json."""
    try:
        data = load_json(VERSION_FILE)
        return data.get("version", "0.0.0")
    except (FileNotFoundError, json.JSONDecodeError):
        return "0.0.0"


def get_config() -> dict:
    """Carica la configurazione da config.json."""
    try:
        return load_json(CONFIG_FILE)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "github_api": "https://api.github.com/repos/Gigagadget/question-lab",
            "protected_files": ["database.json", "categories.json", "version.json", "config.json"],
            "protected_dirs": ["databases"],
            "update_settings": {"max_retries": 3, "timeout_seconds": 30},
        }


def _prerelease_priority(suffix: str) -> int:
    """
    Assegna una priorità al suffisso pre-release (SemVer 2.0.0).
    Ordine: dev(0) < alpha(1) < beta(2) < rc(3) < release(4)
    """
    if not suffix:
        return 4  # release
    s = suffix.lower()
    if "dev" in s:
        return 0
    if "alpha" in s or "a" == s:
        return 1
    if "beta" in s or "b" == s:
        return 2
    if "rc" in s:
        return 3
    # Sconosciuto: trattalo come dev
    return 0


def _extract_prerelease_number(suffix: str) -> int:
    """
    Estrae il numero dal suffisso (es: rc1 → 1, beta2 → 2).
    Serve per confrontare rc1 vs rc2.
    """
    if not suffix:
        return 0
    match = re.search(r'(\d+)', suffix)
    return int(match.group(1)) if match else 0


def parse_semver(version: str) -> Tuple[int, int, int, str]:
    """
    Converte una stringa semver in tupla (major, minor, patch, prerelease_suffix).
    Esempi:
        '1.5.0'    → (1, 5, 0, '')
        '1.6.0-dev' → (1, 6, 0, 'dev')
        '1.6.0-rc1' → (1, 6, 0, 'rc1')
    """
    version = version.strip().lstrip("v")
    # Separa la parte numerica dal suffisso
    match = re.match(r"(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?", version)
    if match:
        major = int(match.group(1))
        minor = int(match.group(2))
        patch = int(match.group(3))
        suffix = match.group(4) or ""
        return (major, minor, patch, suffix)
    return (0, 0, 0, "")


def compare_versions(local: str, remote: str) -> int:
    """
    Confronta due versioni semver secondo SemVer 2.0.0.
    Le pre-release sono SEMPRE più vecchie della release corrispondente.
    Es: 1.6.0-dev < 1.6.0 < 1.6.0-rc1 < 1.6.1
    Returns:
        -1 se local < remote
         0 se local == remote
         1 se local > remote
    """
    local_tuple = parse_semver(local)
    remote_tuple = parse_semver(remote)

    # Confronta major.minor.patch
    local_base = local_tuple[:3]
    remote_base = remote_tuple[:3]

    if local_base < remote_base:
        return -1
    elif local_base > remote_base:
        return 1

    # Stessa major.minor.patch: confronta il suffisso
    local_suffix = local_tuple[3]
    remote_suffix = remote_tuple[3]

    # Nessuno dei due ha suffisso → uguali
    if not local_suffix and not remote_suffix:
        return 0

    # Release (nessun suffisso) > pre-release
    if not local_suffix and remote_suffix:
        return 1  # local è release, remote è pre-release
    if local_suffix and not remote_suffix:
        return -1  # local è pre-release, remote è release

    # Entrambi pre-release: confronta priorità e numero
    local_pri = _prerelease_priority(local_suffix)
    remote_pri = _prerelease_priority(remote_suffix)

    if local_pri != remote_pri:
        return -1 if local_pri < remote_pri else 1

    # Stessa priorità: confronta numero (es: rc1 vs rc2)
    local_num = _extract_prerelease_number(local_suffix)
    remote_num = _extract_prerelease_number(remote_suffix)

    if local_num < remote_num:
        return -1
    elif local_num > remote_num:
        return 1

    return 0


def get_latest_github_tag(config: dict, verbose: bool = True) -> Optional[str]:
    """
    Ottiene l'ultimo tag semver da GitHub usando le API.
    Restituisce il nome del tag senza prefisso 'v'.
    Di default ignora i tag pre-release (es: 1.6.0-dev).
    Per includerli, impostare "allow_prerelease": true nel config.
    """
    api_url = config["github_api"]
    tags_url = f"{api_url}/tags"
    max_retries = config.get("update_settings", {}).get("max_retries", 3)
    timeout = config.get("update_settings", {}).get("timeout_seconds", 30)
    allow_prerelease = config.get("update_settings", {}).get("allow_prerelease", False)

    if verbose:
        print(f"  🔄 Controllo aggiornamenti su GitHub...")
        print(f"  📡 URL API: {tags_url}")
        if allow_prerelease:
            print(f"  🧪 Modalità pre-release abilitata")

    for attempt in range(1, max_retries + 1):
        try:
            if verbose:
                print(f"  📡 Tentativo {attempt}/{max_retries}...")
            response = requests.get(tags_url, timeout=timeout)
            response.raise_for_status()
            tags = response.json()

            if not tags:
                if verbose:
                    print(f"  ⚠️  Nessun tag trovato su GitHub.")
                return None

            # Filtra tag che sembrano semver (con o senza suffisso pre-release)
            # Pure semver: v1.5.0, 1.5.0
            # Pre-release: v1.6.0-dev, v1.6.0-rc1, v1.6.0-beta.2
            semver_pattern = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$")
            matched_tags = [t for t in tags if semver_pattern.match(t.get("name", ""))]

            if not matched_tags:
                if verbose:
                    print(f"  ⚠️  Nessun tag semver trovato su GitHub.")
                return None

            # Se allow_prerelease è disabilitato, filtra via i tag con suffisso
            if not allow_prerelease:
                semver_tags = []
                for t in matched_tags:
                    parsed = parse_semver(t["name"])
                    if not parsed[3]:  # Nessun suffisso pre-release
                        semver_tags.append(t)
                if not semver_tags:
                    if verbose:
                        print(f"  ℹ️  Solo tag pre-release disponibili. Abilita \"allow_prerelease\" nel config per scaricarli.")
                    return None
            else:
                semver_tags = matched_tags

            # Ordina i tag per versione (più recente prima)
            semver_tags.sort(key=lambda t: parse_semver(t["name"]), reverse=True)
            latest_tag = semver_tags[0]["name"].lstrip("v")

            if verbose:
                print(f"  ✅ Ultimo tag trovato: v{latest_tag}")
            return latest_tag

        except requests.exceptions.ConnectionError:
            if verbose:
                print(f"  ❌ Errore di connessione (tentativo {attempt}/{max_retries})")
        except requests.exceptions.Timeout:
            if verbose:
                print(f"  ❌ Timeout (tentativo {attempt}/{max_retries})")
        except requests.exceptions.HTTPError as e:
            if verbose:
                print(f"  ❌ Errore HTTP: {e}")
            if response.status_code == 403:
                if verbose:
                    print(f"  ⚠️  Rate limit GitHub API raggiunto. Riprova più tardi.")
                return None
        except Exception as e:
            if verbose:
                print(f"  ❌ Errore imprevisto: {e}")

        if attempt < max_retries:
            import time
            time.sleep(2)

    if verbose:
        print(f"  ❌ Tutti i tentativi falliti. Impossibile contattare GitHub.")
    return None


def download_zip(repo_url: str, config: dict, tag: str = None, verbose: bool = True) -> Optional[bytes]:
    """
    Scarica lo ZIP del repository.
    Se viene fornito un tag, scarica dal tag specifico (consigliato).
    Altrimenti fallback al branch configurato.

    URL formato (tag): https://github.com/{owner}/{repo}/archive/refs/tags/{tag}.zip
    URL formato (branch): https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip
    """
    if not repo_url or not repo_url.strip():
        if verbose:
            print(f"  ❌ github_repo non configurato in config.json")
        return None

    # Estrai owner e repo dall'URL
    repo_url = repo_url.rstrip("/")
    parts = repo_url.rstrip(".git").split("/")
    if len(parts) < 2:
        if verbose:
            print(f"  ❌ github_repo non valido: '{repo_url}'")
        return None
    owner, repo = parts[-2], parts[-1]

    # Costruisci URL: priorità al tag, fallback al branch
    if tag:
        zip_url = f"https://github.com/{owner}/{repo}/archive/refs/tags/v{tag.lstrip('v')}.zip"
        if verbose:
            print(f"  📥 Download aggiornamento dal tag: v{tag.lstrip('v')}")
    else:
        branch = config.get("branch", "main")
        zip_url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip"
        if verbose:
            print(f"  📥 Download aggiornamento dal branch: {branch}")

    max_retries = config.get("update_settings", {}).get("max_retries", 3)
    timeout = config.get("update_settings", {}).get("timeout_seconds", 30)

    for attempt in range(1, max_retries + 1):
        try:
            if verbose:
                print(f"  📡 Tentativo {attempt}/{max_retries}...")
            response = requests.get(zip_url, timeout=timeout, stream=True)
            response.raise_for_status()
            content = response.content
            if verbose:
                print(f"  ✅ Download completato ({len(content) / 1024:.1f} KB)")
            return content
        except requests.exceptions.ConnectionError:
            if verbose:
                print(f"  ❌ Errore di connessione (tentativo {attempt}/{max_retries})")
        except requests.exceptions.Timeout:
            if verbose:
                print(f"  ❌ Timeout (tentativo {attempt}/{max_retries})")
        except Exception as e:
            if verbose:
                print(f"  ❌ Errore: {e}")

        if attempt < max_retries:
            import time
            time.sleep(2)

    if verbose:
        print(f"  ❌ Download fallito dopo {max_retries} tentativi.")
    return None


def create_backup(verbose: bool = True) -> Optional[str]:
    """
    Crea un backup della cartella corrente prima dell'update.
    Esclude file/directory protetti.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = BASE_DIR / "update_backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"backup_{timestamp}"

    config = get_config()
    protected_files = set(config.get("protected_files", []))
    protected_dirs = set(config.get("protected_dirs", []))

    if verbose:
        print(f"  📦 Creazione backup in: {backup_path}")

    try:
        backup_path.mkdir(parents=True, exist_ok=True)

        for item in BASE_DIR.iterdir():
            # Salta il file di backup stesso
            if item.name.startswith("."):
                continue

            # Salta directory protette
            if item.is_dir() and item.name in protected_dirs:
                if verbose:
                    print(f"    ⏭️  Saltata directory protetta: {item.name}/")
                continue

            # Salta file protetti
            if item.is_file() and item.name in protected_files:
                if verbose:
                    print(f"    ⏭️  Saltato file protetto: {item.name}")
                continue

            # Copia file o directory
            dest = backup_path / item.name
            if item.is_dir():
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)

        if verbose:
            print(f"  ✅ Backup completato")
        return str(backup_path)

    except Exception as e:
        if verbose:
            print(f"  ❌ Errore nel backup: {e}")
        return None


def migrate_to_server_structure(verbose: bool = True) -> bool:
    """
    Migra la struttura del progetto spostando app.py nella cartella server/.
    Gestisce la transizione dalla vecchia struttura (app.py nella root) alla nuova (server/app.py).
    """
    try:
        old_app = BASE_DIR / "app.py"
        server_dir = BASE_DIR / "server"
        new_app = server_dir / "app.py"
        init_file = server_dir / "__init__.py"

        # Caso 1: Nuova struttura già presente (server/app.py esiste)
        if new_app.exists():
            # Rimuovi il vecchio app.py se esiste ancora
            if old_app.exists():
                if verbose:
                    print(f"    🧹 Rimozione vecchio app.py dalla root...")
                try:
                    old_app.unlink()
                    if verbose:
                        print(f"    ✅ Vecchio app.py rimosso")
                except Exception as e:
                    if verbose:
                        print(f"    ⚠️  Impossibile rimuovere vecchio app.py: {e}")
            return True

        # Caso 2: Vecchia struttura (app.py nella root, server/ non esiste)
        if old_app.exists() and not server_dir.exists():
            if verbose:
                print(f"    🔄 Migrazione a struttura server/...")
            server_dir.mkdir(parents=True, exist_ok=True)
            init_file.write_text("# Server package\n")
            shutil.move(str(old_app), str(new_app))
            if verbose:
                print(f"    ✅ app.py spostato in server/app.py")
            return True

        # Caso 3: Situazione ibrida
        if old_app.exists() and server_dir.exists() and not new_app.exists():
            if verbose:
                print(f"    🔄 Completamento migrazione a struttura server/...")
            shutil.move(str(old_app), str(new_app))
            if verbose:
                print(f"    ✅ app.py spostato in server/app.py")
            return True

        return True

    except Exception as e:
        if verbose:
            print(f"    ❌ Errore nella migrazione: {e}")
        return False


def apply_update(zip_content: bytes, config: dict, verbose: bool = True) -> bool:
    """
    Estrae lo ZIP e applica l'aggiornamento, escludendo file/directory protetti.
    Gestisce: nuovi file, file modificati, file eliminati, cambiamenti struttura.
    """
    protected_files = set(config.get("protected_files", []))
    protected_dirs = set(config.get("protected_dirs", []))

    # Protezione hardcoded aggiuntiva per sicurezza
    protected_dirs.add("databases")
    protected_dirs.add("update_backups")

    if verbose:
        print(f"  📂 Applicazione aggiornamento...")

    try:
        # Estrai in una temp directory
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = Path(temp_dir) / "update.zip"
            zip_path.write_bytes(zip_content)

            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(temp_dir)

            # Trova la directory estratta (di solito repo-branch/)
            extracted_items = list(Path(temp_dir).iterdir())
            source_dir = None
            for item in extracted_items:
                if item.is_dir() and item.name != "__MACOSX":
                    source_dir = item
                    break

            if not source_dir:
                if verbose:
                    print(f"  ❌ Impossibile trovare i file estratti.")
                return False

            if verbose:
                print(f"  📂 File estratti da: {source_dir}")

            # Raccogli tutti i file presenti nel nuovo ZIP (relativi alla base dir)
            new_files = set()
            for item in source_dir.rglob("*"):
                relative_path = item.relative_to(source_dir)

                # Salta directory protette
                if item.is_dir() and relative_path.parts[0] in protected_dirs:
                    continue

                # Salta file protetti
                if item.is_file() and relative_path.name in protected_files:
                    continue

                # Salta file nella root che sono protetti
                if item.is_file() and item.parent == source_dir and item.name in protected_files:
                    continue

                if item.is_file():
                    new_files.add(relative_path)
                    dest = BASE_DIR / relative_path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, dest)

            files_updated = len(new_files)

            # Rimuovi file locali che non esistono più nel nuovo ZIP
            files_removed = 0
            for item in list(BASE_DIR.rglob("*")):
                if not item.is_file():
                    continue

                relative_path = item.relative_to(BASE_DIR)

                # Salta directory protette (e loro contenuti)
                if relative_path.parts[0] in protected_dirs:
                    continue

                # Salta file protetti
                if item.name in protected_files:
                    continue

                # Salta file nascosti e di sistema
                if item.name.startswith("."):
                    continue

                # Se il file non è nel nuovo ZIP, eliminalo
                if relative_path not in new_files:
                    try:
                        item.unlink()
                        files_removed += 1
                        if verbose:
                            print(f"    🗑️  Rimosso file obsoleto: {relative_path}")
                    except Exception as e:
                        if verbose:
                            print(f"    ⚠️  Impossibile rimuovere {relative_path}: {e}")

            # Pulisci directory vuote (escluse quelle protette)
            for item in sorted(BASE_DIR.rglob("*"), reverse=True):
                if item.is_dir() and item.name not in protected_dirs:
                    try:
                        if not any(item.iterdir()):
                            item.rmdir()
                            if verbose:
                                print(f"    🗑️  Rimossa directory vuota: {item.relative_to(BASE_DIR)}")
                    except OSError:
                        pass  # Directory non vuota o protetta

            # Gestione speciale per migrazione a struttura server/
            # Se server/app.py è stato copiato ma app.py nella root esiste ancora, rimuovilo
            old_app = BASE_DIR / "app.py"
            new_app = BASE_DIR / "server" / "app.py"
            if new_app.exists() and old_app.exists():
                try:
                    old_app.unlink()
                    if verbose:
                        print(f"    🧹 Rimosso vecchio app.py dalla root (migrato in server/)")
                    files_removed += 1
                except Exception as e:
                    if verbose:
                        print(f"    ⚠️  Impossibile rimuovere vecchio app.py: {e}")

            if verbose:
                print(f"  ✅ Aggiornamento applicato: {files_updated} file aggiornati, {files_removed} file obsoleti rimossi")
            return True

    except Exception as e:
        if verbose:
            print(f"  ❌ Errore nell'applicazione dell'aggiornamento: {e}")
        return False


def log_update(from_version: str, to_version: str, status: str, details: str = "") -> None:
    """Registra l'aggiornamento nel file di log."""
    try:
        if UPDATE_LOG_FILE.exists():
            log_data = load_json(UPDATE_LOG_FILE)
        else:
            log_data = {"updates": []}

        log_entry = {
            "date": datetime.now().isoformat(),
            "from_version": from_version,
            "to_version": to_version,
            "status": status,
            "details": details,
        }
        log_data["updates"].append(log_entry)
        save_json(UPDATE_LOG_FILE, log_data)
    except Exception as e:
        print(f"  ⚠️  Errore nel salvataggio del log: {e}")


def get_version_from_zip(zip_content: bytes, verbose: bool = True) -> Optional[str]:
    """
    Estrae version.json dallo ZIP e legge la versione dal file.
    Questo bypassa la protezione di version.json e legge la versione REALE
    dal pacchetto scaricato, non dal tag GitHub.
    """
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = Path(temp_dir) / "temp.zip"
            zip_path.write_bytes(zip_content)

            with zipfile.ZipFile(zip_path, "r") as zf:
                # Trova version.json
                version_entries = [n for n in zf.namelist() if n.endswith("version.json")]

                if not version_entries:
                    if verbose:
                        print(f"  ⚠️  Nessun version.json trovato nello ZIP")
                    return None

                # Prendi il primo (di solito c'è un solo version.json nella root)
                version_entry = version_entries[0]
                content = zf.read(version_entry).decode("utf-8")
                data = json.loads(content)
                version = data.get("version")

                if version and verbose:
                    print(f"  📄 Versione dallo ZIP: v{version}")

                return version

    except Exception as e:
        if verbose:
            print(f"  ⚠️  Errore leggendo version.json dallo ZIP: {e}")
        return None


def update_version_file(version: str, status: str, source: str = "tag") -> None:
    """Aggiorna il file version.json con la nuova versione.
    source: 'tag' (da tag GitHub) o 'zip' (da version.json nello ZIP)
    """
    try:
        data = {
            "version": version,
            "last_update": datetime.now().isoformat(),
            "last_update_status": status,
            "version_source": source,
        }
        save_json(VERSION_FILE, data)
    except Exception as e:
        print(f"  ⚠️  Errore nell'aggiornamento di version.json: {e}")


def check_and_update(verbose: bool = True) -> bool:
    """
    Funzione principale: controlla e applica l'aggiornamento.
    Returns: True se l'update è stato applicato con successo, False altrimenti.
    """
    if verbose:
        print("\n" + "=" * 50)
        print("🔄 CONTROLLO AGGIORNAMENTI")
        print("=" * 50)

    config = get_config()
    local_version = get_local_version()

    if verbose:
        print(f"  📌 Versione locale: v{local_version}")

    # Ottieni versione remota
    remote_version = get_latest_github_tag(config, verbose)

    if remote_version is None:
        if verbose:
            print(f"  ⚠️  Impossibile verificare aggiornamenti. Avvio con versione corrente.")
        log_update(local_version, local_version, "check_failed", "Impossibile contattare GitHub")
        return False

    # Confronta versioni
    comparison = compare_versions(local_version, remote_version)

    if comparison == 1:
        # Locale > Remoto
        if verbose:
            print(f"  ⚠️  ATTENZIONE: La versione locale (v{local_version}) è più recente di GitHub (v{remote_version})!")
            print(f"  ℹ️  Se questo è inaspettato, verifica la configurazione della repository.")
        log_update(local_version, remote_version, "local_newer", "Versione locale più recente")
        return False

    elif comparison == 0:
        # Locale == Remoto
        # Verifica se la versione locale proviene da un tag (vecchio codice) o da ZIP (nuovo codice)
        # Se proviene da un tag, estraiamo comunque dallo ZIP per correggere la versione
        try:
            ver_data = load_json(VERSION_FILE)
            version_source = ver_data.get("version_source", "tag")
        except:
            version_source = "tag"

        if version_source == "tag":
            if verbose:
                print(f"  🔍 Versione da tag: verifica versione reale dallo ZIP...")
            repo_url = config.get("github_repo", "")
            zip_content = download_zip(repo_url, config, tag=remote_version, verbose=verbose)
            if zip_content:
                zip_version = get_version_from_zip(zip_content, verbose)
                if zip_version and zip_version != local_version:
                    update_version_file(zip_version, "version_corrected", source="zip")
                    if verbose:
                        print(f"  ✅ Versione corretta: v{local_version} → v{zip_version}")
                    # Rilancia il server con la versione corretta
                    return False  # Non serve riavviare, la versione è stata corretta
                elif zip_version:
                    if verbose:
                        print(f"  ✅ La versione è confermata (v{local_version})")
                else:
                    if verbose:
                        print(f"  ℹ️  Versione da ZIP non disponibile, mantengo v{local_version}")
            else:
                if verbose:
                    print(f"  ℹ️  Download ZIP fallito, mantengo v{local_version}")
        else:
            if verbose:
                print(f"  ✅ La versione è aggiornata (v{local_version})")

        log_update(local_version, remote_version, "up_to_date", "Nessun aggiornamento necessario")
        return False

    else:
        # Locale < Remoto → Aggiorna
        if verbose:
            print(f"  🔄 Nuova versione disponibile: v{local_version} → v{remote_version}")
            print(f"  📦 Preparazione aggiornamento...")

        # Crea backup
        backup_path = create_backup(verbose)
        if not backup_path:
            if verbose:
                print(f"  ⚠️  Backup fallito, ma procedo con l'update...")

        # Scarica ZIP dal tag specifico
        repo_url = config.get("github_repo", "")
        zip_content = download_zip(repo_url, config, tag=remote_version, verbose=verbose)

        if not zip_content:
            if verbose:
                print(f"  ❌ Download fallito. Avvio con versione corrente.")
            log_update(local_version, remote_version, "download_failed", "Download ZIP fallito")
            return False

        # Applica aggiornamento
        success = apply_update(zip_content, config, verbose)

        if success:
            # Migra la struttura a server/ se necessario
            if verbose:
                print(f"  🔄 Verifica struttura del progetto...")
            migrate_to_server_structure(verbose)

            # Leggi la versione REALE dal version.json nello ZIP (approccio ibrido)
            zip_version = get_version_from_zip(zip_content, verbose)

            # Usa sempre la versione dallo ZIP se disponibile,
            # perché riflette il codice effettivamente installato
            actual_version = zip_version or remote_version
            version_source = "zip" if zip_version else "tag"

            # Aggiorna version.json con la versione effettiva
            update_version_file(actual_version, "success", source=version_source)
            log_update(local_version, actual_version, "success", f"Aggiornamento completato")
            if verbose:
                tag_note = f" (tag: v{remote_version})" if zip_version and actual_version != remote_version else ""
                print(f"  🎉 Aggiornamento completato: v{local_version} → v{actual_version}{tag_note}")
            return True
        else:
            if verbose:
                print(f"  ❌ Aggiornamento fallito. Ripristino dal backup...")
            # Ripristina dal backup se disponibile
            if backup_path:
                try:
                    for item in Path(backup_path).iterdir():
                        dest = BASE_DIR / item.name
                        if item.is_dir():
                            if dest.exists():
                                shutil.rmtree(dest)
                            shutil.copytree(item, dest)
                        else:
                            shutil.copy2(item, dest)
                    if verbose:
                        print(f"  ✅ Ripristino completato dal backup")
                except Exception as e:
                    if verbose:
                        print(f"  ❌ Errore nel ripristino: {e}")

            log_update(local_version, remote_version, "apply_failed", "Applicazione aggiornamento fallita")
            return False