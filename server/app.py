import subprocess
import sys
from pathlib import Path

# Imposta il percorso base alla root del progetto (directory padre di server/)
BASE_DIR = Path(__file__).resolve().parent.parent

def check_and_install_requirements():
    """Verifica e installa i pacchetti richiesti"""
    requirements = [
        'Flask==2.3.3',
        'flask-cors==4.0.0',
        'python-docx==1.1.0',
        'reportlab==4.0.4',
        'requests==2.31.0'
    ]
    
    print("Verifica dei requisiti...", flush=True)
    
    for requirement in requirements:
        package_name = requirement.split('==')[0]
        try:
            # Check if package is already installed using pip show
            result = subprocess.run([sys.executable, '-m', 'pip', 'show', package_name], 
                                    capture_output=True, text=True)
            if result.returncode == 0:
                # Package is installed, check if it's the correct version
                installed_version = None
                for line in result.stdout.split('\n'):
                    if line.startswith('Version:'):
                        installed_version = line.split(':', 1)[1].strip()
                        break
                
                required_version = requirement.split('==')[1]
                if installed_version == required_version:
                    print(f"✓ {package_name}=={required_version} già installato", flush=True)
                    continue
                else:
                    print(f"⚠ {package_name} versione non corrispondente (installata: {installed_version}, richiesta: {required_version})", flush=True)
            
            # If we reach here, either package isn't installed or version doesn't match
            print(f"Installazione di {requirement}...", flush=True)
            try:
                subprocess.check_call([sys.executable, '-m', 'pip', 'install', requirement])
                print(f"✓ {package_name} installato con successo", flush=True)
            except subprocess.CalledProcessError as e:
                print(f"✗ Installazione di {package_name} fallita: {e}", flush=True)
                sys.exit(1)
        except Exception as e:
            # Fallback to import method if pip show fails for some reason
            try:
                import importlib
                try:
                    importlib.import_module(package_name.replace('-', '_'))
                except ImportError:
                    # Some packages have different import names (e.g., flask-cors -> flask_cors)
                    if package_name == 'flask-cors':
                        importlib.import_module('flask_cors')
                    elif package_name == 'python-docx':
                        importlib.import_module('docx')
                    elif package_name == 'reportlab':
                        importlib.import_module('reportlab')
                    else:
                        raise ImportError
                print(f"✓ {package_name} già installato", flush=True)
            except ImportError:
                print(f"Installazione di {requirement}...", flush=True)
                try:
                    subprocess.check_call([sys.executable, '-m', 'pip', 'install', requirement])
                    print(f"✓ {package_name} installato con successo", flush=True)
                except subprocess.CalledProcessError as e:
                    print(f"✗ Installazione di {package_name} fallita: {e}", flush=True)
                    sys.exit(1)
    
    print("Tutti i requisiti sono soddisfatti!", flush=True)

# Check and install requirements before importing
check_and_install_requirements()

# Aggiungi la root del progetto al sys.path per importare i moduli
sys.path.insert(0, str(BASE_DIR))

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import json
import os
import shutil
import logging
from datetime import datetime
from modules.export_utils import generate_doc, generate_pdf
from server.databases import databases_bp, get_active_database_path, get_active_categories_path, get_database_backup_dir as get_db_backup_dir
from server.quiz import quiz_bp
from server.categories import categories_bp as categories_blueprint
from server.backups import backups_bp

app = Flask(
    __name__,
    static_folder=str(BASE_DIR / 'static'),
    static_url_path='/static',
    template_folder=str(BASE_DIR / 'templates')
)
CORS(app)

# Registra i blueprint
app.register_blueprint(databases_bp)
app.register_blueprint(quiz_bp)
app.register_blueprint(categories_blueprint)
app.register_blueprint(backups_bp)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Directory per backup e preferenze
BACKUP_DIR = str(BASE_DIR / 'backup')
USER_PREFS_FILE = str(BASE_DIR / 'preferences.json')

def get_database_backup_dir():
    """Ottiene la directory di backup specifica per il database corrente"""
    active_db_path = get_active_database_path()
    if active_db_path and active_db_path.exists():
        # Usa la cartella backup/ dentro la cartella del database attivo
        return str(active_db_path.parent / "backup")
    # Nessun database attivo: restituisci None
    return None

def migrate_old_backups():
    """Migra i backup dalla vecchia struttura alla nuova (sottocartelle per database)"""
    if not os.path.exists(BACKUP_DIR):
        return 0

    db_backup_dir = get_database_backup_dir()
    if db_backup_dir is None:
        # Nessun database attivo: salta la migrazione dei backup
        logger.info("⚠️ Nessun database attivo: migrazione backup saltata")
        return 0

    if not os.path.exists(db_backup_dir):
        os.makedirs(db_backup_dir)

    migrated_count = 0
    for file in os.listdir(BACKUP_DIR):
        if file.endswith('.json'):
            old_path = os.path.join(BACKUP_DIR, file)
            new_path = os.path.join(db_backup_dir, file)
            if not os.path.exists(new_path):
                shutil.move(old_path, new_path)
                migrated_count += 1
                logger.info(f"Backup migrato: {file}")

    return migrated_count

def create_backup():
    """Crea un backup del database con timestamp (usa database attivo se disponibile)"""
    # Usa il database attivo dalla cartella databases/ se disponibile
    active_db_path = get_active_database_path()
    if not active_db_path or not active_db_path.exists():
        logger.warning("Tentativo di backup senza database attivo")
        return None  # Nessun database attivo

    db_path = str(active_db_path)

    # Backup nella cartella del database attivo
    db_backup_dir = active_db_path.parent / "backup"

    if not os.path.exists(db_backup_dir):
        os.makedirs(db_backup_dir)

    if os.path.exists(db_path):
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        db_name = Path(db_path).stem
        backup_file = os.path.join(db_backup_dir, f'{db_name}_{timestamp}.json')
        shutil.copy2(db_path, backup_file)
        logger.info(f"Backup creato: {backup_file}")
        return backup_file
    return None

def load_database():
    """Carica il database JSON da file (usa database attivo se disponibile)"""
    # Usa il database attivo dalla cartella databases/ se disponibile
    active_db_path = get_active_database_path()

    # Se nessun database attivo, restituisci errore
    if not active_db_path or not active_db_path.exists():
        return None  # Segnala che nessun database è selezionato

    db_path = str(active_db_path)

    if not os.path.exists(db_path):
        # Non creare file automaticamente: il database dovrebbe esistere
        return []

    try:
        with open(db_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Errore nel parsing del database: {e}")
        return []
    except Exception as e:
        logger.error(f"Errore nel caricamento del database: {e}")
        return []

def save_database(data, create_backup_file=True):
    """Salva il database JSON su file con backup (usa database attivo se disponibile)"""
    # Usa il database attivo dalla cartella databases/ se disponibile
    active_db_path = get_active_database_path()

    # Se nessun database attivo, non salvare
    if not active_db_path or not active_db_path.exists():
        logger.warning("Tentativo di salvataggio senza database attivo")
        return False

    db_path = str(active_db_path)

    try:
        if create_backup_file and os.path.exists(db_path):
            create_backup()

        with open(db_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info(f"Database salvato con successo con {len(data)} elementi in {db_path}")
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio del database: {e}")
        return False

def load_categories():
    """Carica le categorie da file separato (usa database attivo se disponibile)"""
    default_categories = {
        "primary_domains": ["indefinito"],
        "subdomains": ["indefinito"]
    }

    # Usa il categories.json del database attivo se disponibile
    active_categories_path = get_active_categories_path()

    # Se nessun database attivo, restituisci None
    if not active_categories_path or not active_categories_path.exists():
        return None  # Segnala che nessun database è selezionato

    categories_path = str(active_categories_path)

    if not os.path.exists(categories_path):
        # Non creare file automaticamente: le categorie dovrebbero esistere
        return default_categories

    try:
        with open(categories_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return default_categories

def save_categories(categories):
    """Salva le categorie su file separato (usa database attivo se disponibile)"""
    # Usa il categories.json del database attivo se disponibile
    active_categories_path = get_active_categories_path()

    # Se nessun database attivo, non salvare
    if not active_categories_path or not active_categories_path.exists():
        logger.warning("Tentativo di salvataggio categorie senza database attivo")
        return False

    categories_path = str(active_categories_path)

    try:
        with open(categories_path, 'w', encoding='utf-8') as f:
            json.dump(categories, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio delle categorie: {e}")
        return False

def load_user_prefs():
    """Carica le preferenze utente da file JSON"""
    default_prefs = {"theme": "light"}
    
    if not os.path.exists(USER_PREFS_FILE):
        save_user_prefs(default_prefs)
        return default_prefs
    
    try:
        with open(USER_PREFS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Errore nel caricamento delle preferenze: {e}")
        return default_prefs

def save_user_prefs(prefs):
    """Salva le preferenze utente su file JSON"""
    try:
        with open(USER_PREFS_FILE, 'w', encoding='utf-8') as f:
            json.dump(prefs, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio delle preferenze: {e}")
        return False

def get_unique_categories(questions):
    """Estrae i valori unici di primary_domain e subdomain dalle domande E dal file categorie"""
    saved_categories = load_categories()
    primary_domains = set(saved_categories.get("primary_domains", []))
    subdomains = set(saved_categories.get("subdomains", []))
    
    for q in questions:
        if q.get('primary_domain') and q['primary_domain'].strip():
            primary_domains.add(q['primary_domain'].strip())
        if q.get('subdomain') and q['subdomain'].strip():
            subdomains.add(q['subdomain'].strip())
    
    merged_categories = {
        "primary_domains": sorted(list(primary_domains)),
        "subdomains": sorted(list(subdomains))
    }
    save_categories(merged_categories)
    
    return sorted(list(primary_domains)), sorted(list(subdomains))

# ==================== PAGINE ====================

def get_local_ip():
    """Ottiene l'indirizzo IP locale del server"""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


def get_app_version():
    """Restituisce la versione corrente da version.json."""
    version_file = BASE_DIR / "version.json"
    try:
        with open(version_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("version", "N/D")
    except Exception:
        return "N/D"


@app.route('/')
def home():
    """Pagina principale di navigazione"""
    server_ip = get_local_ip()
    app_version = get_app_version()
    return render_template('index.html', server_ip=server_ip, app_version=app_version)

@app.route('/editor')
def editor():
    """Pagina editor - modifica domande"""
    return render_template('editor.html')

@app.route('/quiz')
def quiz():
    """Pagina modalità quiz"""
    return render_template('quiz.html')

@app.route('/view')
def view():
    """Pagina modalità visualizzazione"""
    return render_template('view.html')

@app.route('/databases')
def databases_page():
    """Pagina gestione database"""
    return render_template('databases.html')

# ==================== API PREFERENZE ====================

@app.route('/api/preferences', methods=['GET'])
def get_preferences():
    """Ottiene le preferenze utente"""
    try:
        prefs = load_user_prefs()
        return jsonify(prefs), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/preferences: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/preferences', methods=['POST'])
def save_preferences():
    """Salva le preferenze utente"""
    try:
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({"error": "Formato dati non valido"}), 400
        
        # Assicura che abbia almeno la chiave 'theme'
        if 'theme' not in data:
            return jsonify({"error": "Campo 'theme' obbligatorio"}), 400
        
        if save_user_prefs(data):
            return jsonify({
                "message": "Preferenze salvate con successo",
                "preferences": data
            }), 200
        else:
            return jsonify({"error": "Salvataggio delle preferenze fallito"}), 500
    except Exception as e:
        logger.error(f"Errore in POST /api/preferences: {e}")
        return jsonify({"error": str(e)}), 500

# ==================== API ====================

@app.route('/api/questions', methods=['GET'])
def get_questions():
    """Ottiene tutte le domande dal database"""
    try:
        questions = load_database()
        if questions is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database dalla Gestione Database."}), 400
        categories = get_unique_categories(questions)
        return jsonify({
            'questions': questions,
            'categories': {
                'primary_domains': categories[0],
                'subdomains': categories[1]
            }
        }), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/questions: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/questions', methods=['POST'])
def save_questions():
    """Salva tutte le domande nel database"""
    try:
        data = request.get_json()
        if not isinstance(data, list):
            return jsonify({"error": "Formato dati non valido, previsto un array"}), 400

        if save_database(data):
            categories = get_unique_categories(data)
            return jsonify({
                "message": f"Salvate con successo {len(data)} domande",
                "count": len(data),
                "categories": {
                    'primary_domains': categories[0],
                    'subdomains': categories[1]
                }
            }), 200
        else:
            return jsonify({"error": "Salvataggio del database fallito. Nessun database selezionato."}), 400
    except Exception as e:
        logger.error(f"Errore in POST /api/questions: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/questions/<question_id>', methods=['PUT'])
def update_question(question_id):
    """Aggiorna una singola domanda per ID"""
    try:
        questions = load_database()
        if questions is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        updated_question = request.get_json()

        if not updated_question:
            return jsonify({"error": "Nessun dato fornito"}), 400

        new_id = updated_question.get('id')
        if new_id != question_id and any(q.get('id') == new_id for q in questions):
            return jsonify({"error": "ID già esistente"}), 400

        index = next((i for i, q in enumerate(questions) if q.get('id') == question_id), None)

        if index is not None:
            questions[index] = updated_question
            if save_database(questions):
                return jsonify(updated_question), 200
            else:
                return jsonify({"error": "Salvataggio del database fallito"}), 500
        else:
            return jsonify({"error": "Domanda non trovata"}), 404
    except Exception as e:
        logger.error(f"Errore in PUT /api/questions/{question_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Ottiene le statistiche del database"""
    try:
        questions = load_database()
        if questions is None:
            return jsonify({"error": "Nessun database selezionato", "total_questions": 0, "total_duplicates": 0, "primary_domain_count": {}, "subdomain_count": {}, "questions_with_one_answer": 0, "questions_with_no_answers": 0, "questions_with_no_correct": 0}), 400

        # Count per primary domain
        primary_domain_count = {}
        for q in questions:
            domain = q.get('primary_domain', 'indefinito')
            primary_domain_count[domain] = primary_domain_count.get(domain, 0) + 1

        # Count per subdomain
        subdomain_count = {}
        for q in questions:
            sub = q.get('subdomain', 'indefinito')
            subdomain_count[sub] = subdomain_count.get(sub, 0) + 1

        # Nuove statistiche su risposte
        questions_with_one_answer = 0
        questions_with_no_answers = 0
        questions_with_no_correct = 0

        for q in questions:
            answers = q.get('answers', {})
            # Conta risposte non vuote
            non_empty_answers = sum(1 for v in answers.values() if v and v.strip())

            if non_empty_answers == 1:
                questions_with_one_answer += 1
            elif non_empty_answers == 0:
                questions_with_no_answers += 1

            # Controlla risposte corrette
            correct = q.get('correct', [])
            # Filtra "null" e valori vuoti
            valid_correct = [c for c in correct if c and c != "null"]
            if len(valid_correct) == 0:
                questions_with_no_correct += 1

        stats = {
            "total_questions": len(questions),
            "total_duplicates": sum(1 for q in questions if q.get('duplicate_count', 0) > 0),
            "primary_domain_count": primary_domain_count,
            "subdomain_count": subdomain_count,
            "questions_with_one_answer": questions_with_one_answer,
            "questions_with_no_answers": questions_with_no_answers,
            "questions_with_no_correct": questions_with_no_correct
        }
        return jsonify(stats), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/stats: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/export/doc', methods=['POST'])
def export_doc():
    """Esporta le domande in formato DOC (usa database attivo se disponibile)"""
    try:
        data = request.get_json()
        questions = data.get('questions', [])
        sort_by = data.get('sort_by', 'id')  # 'id' or 'category'
        
        if not questions:
            return jsonify({"error": "Nessuna domanda fornita"}), 400
        
        # Generate filename con nome del database attivo
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        active_db_path = get_active_database_path()
        if active_db_path and active_db_path.exists():
            db_name = active_db_path.parent.name  # Nome della cartella del database
        else:
            db_name = "database"
        filename = f"{db_name}_{timestamp}.docx"
        
        # Generate DOC with sorting
        buffer, _ = generate_doc(questions, filename, sort_by, db_name)
        
        # Send file
        return send_file(
            buffer,
            as_attachment=True,
            download_name=filename,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
    except Exception as e:
        logger.error(f"Errore in POST /api/export/doc: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/export/pdf', methods=['POST'])
def export_pdf():
    """Esporta le domande in formato PDF (usa database attivo se disponibile)"""
    try:
        data = request.get_json()
        questions = data.get('questions', [])
        sort_by = data.get('sort_by', 'id')  # 'id' or 'category'
        
        if not questions:
            return jsonify({"error": "Nessuna domanda fornita"}), 400
        
        # Generate filename con nome del database attivo
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        active_db_path = get_active_database_path()
        if active_db_path and active_db_path.exists():
            db_name = active_db_path.parent.name  # Nome della cartella del database
        else:
            db_name = "database"
        filename = f"{db_name}_{timestamp}.pdf"
        
        # Generate PDF with sorting
        buffer, _ = generate_pdf(questions, filename, sort_by, db_name)
        
        # Send file
        return send_file(
            buffer,
            as_attachment=True,
            download_name=filename,
            mimetype='application/pdf'
        )
    except Exception as e:
        logger.error(f"Errore in POST /api/export/pdf: {e}")
        return jsonify({"error": str(e)}), 500

def migrate_old_database_to_databases_folder():
    """
    Migra il vecchio database.json dalla root alla cartella databases/.
    Crea la struttura databases/database_legacy/ con data.json, categories.json e backup/.
    """
    old_db_file = BASE_DIR / "database.json"
    old_categories_file = BASE_DIR / "categories.json"
    legacy_dir = BASE_DIR / "databases" / "database_legacy"
    legacy_data_file = legacy_dir / "data.json"
    legacy_categories_file = legacy_dir / "categories.json"
    legacy_backup_dir = legacy_dir / "backup"
    
    # Se il database legacy esiste già, non fare nulla
    if legacy_data_file.exists():
        return False
    
    # Se non esiste il vecchio database.json, non fare nulla
    if not old_db_file.exists():
        return False
    
    try:
        logger.info("🔄 Migrazione database esistente nella cartella databases/...")
        
        # Crea la directory legacy
        legacy_dir.mkdir(parents=True, exist_ok=True)
        legacy_backup_dir.mkdir(exist_ok=True)
        
        # Sposta database.json -> databases/database_legacy/data.json
        shutil.move(str(old_db_file), str(legacy_data_file))
        logger.info(f"  ✅ Spostato database.json in {legacy_data_file}")
        
        # Copia categories.json se esiste
        if old_categories_file.exists():
            shutil.copy2(str(old_categories_file), str(legacy_categories_file))
            logger.info(f"  ✅ Copiato categories.json in {legacy_categories_file}")
        
        # Migra i backup dalla vecchia struttura
        old_backup_dir = BASE_DIR / "backup" / "database"
        if old_backup_dir.exists():
            migrated_count = 0
            for backup_file in old_backup_dir.glob("*.json"):
                dest = legacy_backup_dir / backup_file.name
                if not dest.exists():
                    shutil.move(str(backup_file), str(dest))
                    migrated_count += 1
            if migrated_count > 0:
                logger.info(f"  ✅ Migrati {migrated_count} backup nella cartella databases/database_legacy/backup/")
        
        # Aggiorna il file di configurazione dei database
        from server.databases import get_databases_config, save_databases_config
        config = get_databases_config()
        
        # Aggiungi il database legacy alla lista
        now = datetime.now().isoformat()
        config["databases"].append({
            "name": "database_legacy",
            "question_count": len(load_json_file(legacy_data_file)) if legacy_data_file.exists() else 0,
            "created": now,
            "last_modified": now
        })
        config["active_database"] = "database_legacy"
        save_databases_config(config)
        
        logger.info("  ✅ Migrazione completata con successo!")
        return True
        
    except Exception as e:
        logger.error(f"  ❌ Errore nella migrazione: {e}")
        return False


def load_json_file(filepath):
    """Carica un file JSON e restituisce il contenuto."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []


if __name__ == '__main__':
    # Migrazione automatica da versione legacy (quiz log, backup/, file root)
    try:
        from modules.migrate_legacy import run_migration
        run_migration()
    except Exception as e:
        logger.warning(f"Migrazione legacy fallita: {e}")

    # Migra il vecchio database.json nella cartella databases/
    migration_done = migrate_old_database_to_databases_folder()
    if migration_done:
        logger.info("✅ Migrazione database legacy completata")

    # Riconcilia la configurazione dei database con il filesystem
    # (rileva cartelle rinominate, orfane, o con nome non sanitizzato)
    try:
        from server.databases import update_config_from_scan
        config = update_config_from_scan()
        active = config.get("active_database")
        if active:
            logger.info(f"✅ Database attivo: '{active}'")
        else:
            logger.info("⚠️ Nessun database attivo: editor/quiz/view saranno bloccati")
    except Exception as e:
        logger.warning(f"Errore nella riconciliazione dei database: {e}")

    # Migra i backup dalla vecchia struttura alla nuova
    migrated = migrate_old_backups()
    if migrated > 0:
        logger.info(f"Migrati {migrated} backup nella nuova struttura")

    app.run(debug=True, host='0.0.0.0', port=5015)
