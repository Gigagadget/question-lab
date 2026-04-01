#!/usr/bin/env python3
"""
Launcher principale per Question Lab.
Controlla e applica aggiornamenti da GitHub, poi avvia il server Flask.

Utilizzo:
    python start.py           # Output dettagliato
    python start.py --quiet   # Output minimale
    python start.py -q        # Output minimale
    python start.py --no-update  # Salta l'update
"""

import argparse
import subprocess
import sys
from pathlib import Path


def check_requirements():
    """Verifica che i requisiti siano installati."""
    try:
        import requests
        return True
    except ImportError:
        print("⚠️  Installazione dipendenze mancanti...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
            print("✅ Dipendenze installate.")
            return True
        except Exception as e:
            print(f"❌ Errore nell'installazione delle dipendenze: {e}")
            return False


def main():
    """Funzione principale del launcher."""
    # Parse argomenti
    parser = argparse.ArgumentParser(
        description="Question Lab Launcher - Avvia l'applicazione con auto-aggiornamento"
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Modalità silenziosa: output minimale"
    )
    parser.add_argument(
        "--no-update",
        action="store_true",
        help="Salta il controllo aggiornamenti"
    )
    args = parser.parse_args()

    verbose = not args.quiet

    # Banner
    if verbose:
        print("\n" + "=" * 50)
        print("🧪 QUESTION LAB")
        print("=" * 50)

    # Verifica requisiti
    if not check_requirements():
        print("❌ Impossibile continuare senza le dipendenze necessarie.")
        sys.exit(1)

    # Controllo aggiornamenti
    if not args.no_update:
        try:
            from modules.update_utils import check_and_update
            check_and_update(verbose=verbose)
        except Exception as e:
            if verbose:
                print(f"⚠️  Errore nel controllo aggiornamenti: {e}")
                print("ℹ️  Procedo con l'avvio dell'applicazione...")
    else:
        if verbose:
            print("ℹ️  Controllo aggiornamenti saltato (--no-update)")

    # Avvia il server Flask
    if verbose:
        print("\n" + "=" * 50)
        print("🚀 AVVIO SERVER FLASK")
        print("=" * 50 + "\n")

    # Esegui server/app.py
    base_dir = Path(__file__).parent
    app_path = base_dir / "server" / "app.py"
    
    # Se server/app.py non esiste, prova a migrare dalla vecchia struttura
    if not app_path.exists():
        old_app = base_dir / "app.py"
        server_dir = base_dir / "server"
        
        if old_app.exists():
            print("🔄 Migrazione della struttura del progetto in corso...")
            server_dir.mkdir(parents=True, exist_ok=True)
            (server_dir / "__init__.py").write_text("# Server package\n")
            import shutil
            shutil.move(str(old_app), str(app_path))
            print(f"✅ app.py spostato in server/app.py")
        else:
            print(f"❌ File app.py non trovato in: {app_path}")
            sys.exit(1)

    try:
        # Usa subprocess per eseguire app.py
        # In questo modo app.py gira come processo separato
        result = subprocess.run([sys.executable, str(app_path)], cwd=Path(__file__).parent)
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        if verbose:
            print("\n\n⏹️  Server arrestato dall'utente.")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Errore nell'avvio del server: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()