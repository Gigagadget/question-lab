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
        'pyopenssl==23.3.0',
        'cryptography==41.0.7',
        'python-docx==1.1.0',
        'reportlab==4.0.4',
        'requests==2.31.0',
        'bcrypt==4.1.2'
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
                    elif package_name == 'bcrypt':
                        importlib.import_module('bcrypt')
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

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, make_response
from flask_cors import CORS
import json
import os
import shutil
import logging
from datetime import datetime
from modules.export_utils import generate_doc, generate_pdf
from server.databases import databases_bp, get_active_database_path
from server.quiz import quiz_bp
from server.categories import categories_bp as categories_blueprint
from server.backups import backups_bp
from server.utils import (
    get_database_backup_dir,
    create_backup,
    load_database,
    save_database,
    load_categories,
    save_categories,
    load_user_prefs,
    save_user_prefs,
    get_unique_categories,
    normalize_question_categories,
    migrate_old_backups
)

app = Flask(
    __name__,
    static_folder=str(BASE_DIR / 'static'),
    static_url_path='/static',
    template_folder=str(BASE_DIR / 'templates')
)
CORS(app)

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(str(BASE_DIR / 'static'), 'favicon.svg', mimetype='image/svg+xml')

# Registra i blueprint
app.register_blueprint(databases_bp)
app.register_blueprint(quiz_bp)
app.register_blueprint(categories_blueprint)
app.register_blueprint(backups_bp)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== MIDDLEWARE ====================

@app.before_request
def check_lan_access():
    """Middleware per controllare l'accesso LAN in tempo reale"""
    # Escludi static files e favicon dal controllo
    if request.path.startswith('/static/') or request.path == '/favicon.ico':
        return None

    try:
        from server.utils import is_lan_password_set, verify_lan_password
        
        prefs = load_user_prefs()
        lan_access = prefs.get("lan_access", False)
        client_ip = request.remote_addr

        # Sempre permetti localhost: nessuna restrizione
        if client_ip in ('127.0.0.1', '::1', 'localhost'):
            return None

        # ✅ BLOCCA ASSOLUTAMENTE SE LAN E' DISABILITATO - PRIMO CONTROLLO CRITICO
        if not lan_access:
            logger.info(f"Accesso bloccato da IP: {client_ip} (LAN disabilitato)")
            return render_template('blocked.html', client_ip=client_ip), 403

        # ✅ DOPPIA SICUREZZA: Controlliamo di nuovo che password sia impostata
        # Questo è un secondo strato di difesa contro qualsiasi stato inconsistente
        if not is_lan_password_set():
            logger.warning(f"Tentativo accesso remoto ma password LAN non impostata: {client_ip}")
            
            # ✅ Se arriviamo qui LAN era abilitato ma password non esiste più: disabilitiamo LAN automaticamente
            prefs = load_user_prefs()
            prefs["lan_access"] = False
            save_user_prefs(prefs)
            logger.info("LAN access è stato automaticamente disabilitato perché la password non esiste più")
            
            return "Accesso negato: password LAN non configurata", 403

        # Verifica autenticazione Basic Auth
        # Comportamento:
        # - Il campo "Nome utente" può essere lasciato VUOTO o contenere qualsiasi valore
        # - Solo il campo "Password" viene verificato
        # - Questo è un limite del protocollo Basic Auth (i browser mostrano sempre entrambi i campi)
        auth = request.authorization

        # 🔍 DEBUG: Logga esattamente cosa riceviamo
        pw_preview = '***'
        if auth:
            # pw_preview = auth.password[:3] + '***' if auth.password and len(auth.password) > 3 else '***'
            pw_preview = auth.password if auth.password else 'None'
            pw_len = len(auth.password) if auth.password else 0
            logger.debug(f"AUTH RECEIVED: ip={client_ip} path={request.path} username='{auth.username}' password='{pw_preview}' len={pw_len}")
        else:
            logger.debug(f"AUTH NOT PRESENT: ip={client_ip} path={request.path}")
        
        # Verifichiamo se è una richiesta AJAX/Fetch API
        is_xhr = request.headers.get('X-Requested-With') == 'XMLHttpRequest' or \
                 request.accept_mimetypes.best == 'application/json'

        # ✅ Caso 1: Nessun header auth inviato
        if not auth or not auth.password:
            if is_xhr:
                logger.debug(f"SILENT 401 API: {request.path}")
                return jsonify({"error": "Autenticazione richiesta"}), 401
            else:
                logger.debug(f"401 WITH WWW-Authenticate: {request.path}")
                response = make_response('Accesso negato', 401)
                from server.utils import load_config
                config = load_config()
                realm = config.get("lan_auth_realm", "QuestionLab")
                response.headers['WWW-Authenticate'] = f'Basic realm="{realm}: inserisci password, nome utente facoltativo", charset="UTF-8"'
                response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                response.headers['Pragma'] = 'no-cache'
                response.headers['Expires'] = '0'
                return response
        
        # ✅ Caso 2: Header auth presente ma password SBAGLIATA
        if not verify_lan_password(auth.password):
            from server.utils import load_config
            config = load_config()
            if config.get("log_failed_auth", False):
                logger.info(f"❌ PASSWORD SBAGLIATA: ip={client_ip} pw_received='{pw_preview}'")
            
            response = make_response('Accesso negato', 401)
            realm = config.get("lan_auth_realm", "QuestionLab")
            response.headers['WWW-Authenticate'] = f'Basic realm="{realm}: inserisci password, nome utente facoltativo", charset="UTF-8"'
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
            return response
            return response

        # ✅ Caso 3: Autenticazione riuscita
        logger.debug(f"✅ PASSWORD CORRETTA: ip={client_ip} path={request.path}")

        # Tutti i controlli passati: permetti accesso
        return None
        
    except Exception as e:
        # In caso di errore, permetti l'accesso (fail-open)
        logger.error(f"Errore nel middleware LAN access: {e}")
        return None


# ==================== API LAN ACCESS ====================

@app.route('/api/lan-status', methods=['GET'])
def get_lan_status():
    """Ottiene lo stato dell'accesso LAN"""
    try:
        prefs = load_user_prefs()
        return jsonify({"lan_access": prefs.get("lan_access", False)}), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/lan-status: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/lan-status', methods=['POST'])
def set_lan_status():
    """Imposta lo stato dell'accesso LAN"""
    try:
        from server.utils import is_lan_password_set
        
        data = request.get_json()
        if not isinstance(data, dict) or 'lan_access' not in data:
            return jsonify({"error": "Campo 'lan_access' obbligatorio"}), 400

        lan_access = bool(data['lan_access'])
        
        # CONTROLLO CRITICO: Non permettere abilitazione LAN senza password impostata
        if lan_access and not is_lan_password_set():
            return jsonify({
                "error": "Impossibile abilitare LAN: devi prima impostare una password",
                "password_required": True
            }), 400

        prefs = load_user_prefs()
        prefs['lan_access'] = lan_access

        if save_user_prefs(prefs):
            logger.info(f"LAN access impostato a: {lan_access}")
            return jsonify({
                "message": "Stato LAN access aggiornato",
                "lan_access": lan_access
            }), 200
        else:
            return jsonify({"error": "Salvataggio fallito"}), 500
    except Exception as e:
        logger.error(f"Errore in POST /api/lan-status: {e}")
        return jsonify({"error": str(e)}), 500


# ==================== API LAN PASSWORD ====================

@app.route('/api/lan-password-status', methods=['GET'])
def get_lan_password_status():
    """Ottiene stato password LAN"""
    try:
        from server.utils import is_lan_password_set, load_config
        config = load_config()
        return jsonify({
            "is_set": is_lan_password_set(),
            "enabled": config.get("lan_password_enabled", False)
        }), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/lan-password-status: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/lan-password', methods=['POST'])
def set_lan_password_api():
    """Imposta password LAN (solo localhost)"""
    try:
        if request.remote_addr not in ('127.0.0.1', '::1', 'localhost'):
            return jsonify({"error": "Operazione permessa solo da localhost"}), 403
        
        data = request.get_json()
        if not data or 'password' not in data:
            return jsonify({"error": "Password obbligatoria"}), 400
        
        password = data['password'].strip()
        if len(password) < 4:
            return jsonify({"error": "La password deve essere di almeno 4 caratteri"}), 400
        
        from server.utils import set_lan_password
        set_lan_password(password)
        
        # ✅ DISABILITA AUTOMATICAMENTE LAN ACCESS QUANDO VIENE IMPOSTATA UNA NUOVA PASSWORD
        # Questo impedisce il bug dove LAN rimane abilitato dopo cambiamento password
        prefs = load_user_prefs()
        prefs["lan_access"] = False
        save_user_prefs(prefs)
        
        return jsonify({"success": True, "message": "Password impostata con successo. Abilita manualmente l'accesso LAN.", "lan_access": False}), 200
    except Exception as e:
        logger.error(f"Errore in POST /api/lan-password: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/lan-password-remove', methods=['POST'])
def remove_lan_password():
    """Rimuovi password LAN (solo localhost)"""
    try:
        if request.remote_addr not in ('127.0.0.1', '::1', 'localhost'):
            return jsonify({"error": "Operazione permessa solo da localhost"}), 403
        
        from server.utils import load_config, save_config
        config = load_config()
        config["lan_password_hash"] = None
        config["lan_password_enabled"] = False
        save_config(config)
        
        # Disabilita automaticamente LAN access quando password viene rimossa
        prefs = load_user_prefs()
        prefs["lan_access"] = False
        save_user_prefs(prefs)
        
        return jsonify({"success": True, "lan_access": False}), 200
    except Exception as e:
        logger.error(f"Errore in POST /api/lan-password-remove: {e}")
        return jsonify({"error": str(e)}), 500


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

        # Merge con preferenze esistenti per non perdere lan_access e altri campi
        existing_prefs = load_user_prefs()
        existing_prefs.update(data)

        if save_user_prefs(existing_prefs):
            return jsonify({
                "message": "Preferenze salvate con successo",
                "preferences": existing_prefs
            }), 200
        else:
            return jsonify({"error": "Salvataggio delle preferenze fallito"}), 500
    except Exception as e:
        logger.error(f"Errore in POST /api/preferences: {e}")
        return jsonify({"error": str(e)}), 500

# ==================== API ====================

def normalize_questions_with_report(questions, categories):
    """
    Normalizza le categorie delle domande e restituisce warning strutturati
    quando avvengono riallineamenti (fallback).
    """
    changes = []

    for q in questions:
        if not isinstance(q, dict):
            continue

        before_primary = q.get('primary_domain')
        before_subdomain = q.get('subdomain')

        if normalize_question_categories(q, categories):
            after_primary = q.get('primary_domain')
            after_subdomain = q.get('subdomain')
            changes.append({
                "id": q.get('id'),
                "before": {
                    "primary_domain": before_primary,
                    "subdomain": before_subdomain,
                },
                "after": {
                    "primary_domain": after_primary,
                    "subdomain": after_subdomain,
                }
            })

    if not changes:
        return None

    examples = [c.get("id") for c in changes if c.get("id")][:5]
    logger.warning(
        "Normalizzazione categorie applicata a %s domande (esempi: %s)",
        len(changes),
        ", ".join(examples) if examples else "n/a"
    )

    return {
        "category_normalization": {
            "count": len(changes),
            "examples": examples,
            "changes": changes[:5]
        }
    }

@app.route('/api/questions', methods=['GET'])
def get_questions():
    """Ottiene tutte le domande dal database"""
    try:
        questions = load_database()
        if questions is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database dalla Gestione Database."}), 400

        categories = get_unique_categories(questions)
        if categories is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database dalla Gestione Database."}), 400

        warnings = normalize_questions_with_report(questions, categories)
        questions_changed = bool(warnings and warnings.get("category_normalization", {}).get("count", 0) > 0)
        if questions_changed:
            save_database(questions, create_backup_file=False)

        response_payload = {
            'questions': questions,
            'categories': categories
        }
        if warnings:
            response_payload['warnings'] = warnings

        return jsonify(response_payload), 200
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
        
        # Validate: empty answers cannot be marked as correct
        for question in data:
            answers = question.get('answers', {})
            correct = question.get('correct', [])
            # Filter out correct answers that point to empty responses
            question['correct'] = [
                c for c in correct 
                if c in answers and answers.get(c) and answers.get(c).strip()
            ]

        # Costruisce/aggiorna le categorie a partire dai dati in ingresso
        categories = get_unique_categories(data)
        if categories is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database dalla Gestione Database."}), 400

        # Enforce coerenza primary_domain/subdomain + warning strutturati
        warnings = normalize_questions_with_report(data, categories)

        if save_database(data):
            categories = get_unique_categories(data)
            response_payload = {
                "message": f"Salvate con successo {len(data)} domande",
                "count": len(data),
                "categories": categories
            }
            if warnings:
                response_payload["warnings"] = warnings
            return jsonify(response_payload), 200
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
            
        # Validate: empty answers cannot be marked as correct
        answers = updated_question.get('answers', {})
        correct = updated_question.get('correct', [])
        # Filter out correct answers that point to empty responses
        updated_question['correct'] = [
            c for c in correct 
            if c in answers and answers.get(c) and answers.get(c).strip()
        ]

        new_id = updated_question.get('id')
        if new_id != question_id and any(q.get('id') == new_id for q in questions):
            return jsonify({"error": "ID già esistente"}), 400

        index = next((i for i, q in enumerate(questions) if q.get('id') == question_id), None)

        if index is not None:
            questions[index] = updated_question
            categories = get_unique_categories(questions)
            warnings = normalize_questions_with_report(questions, categories)
            if save_database(questions):
                response_payload = {
                    "question": updated_question,
                    "categories": get_unique_categories(questions)
                }
                if warnings:
                    response_payload["warnings"] = warnings
                return jsonify(response_payload), 200
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
            return jsonify({"error": "Nessun database selezionato", "total_questions": 0, "total_duplicates": 0, "primary_domain_count": {}, "subdomain_count": {}, "questions_with_one_answer": 0, "questions_with_no_answers": 0, "questions_with_no_correct": 0, "questions_flagged": 0}), 400

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
        questions_flagged = 0

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
            if non_empty_answers > 0 and len(valid_correct) == 0:
                questions_with_no_correct += 1
            
            # Conta domande flaggate
            if q.get('flagged', False):
                questions_flagged += 1

        stats = {
            "total_questions": len(questions),
            "total_duplicates": sum(1 for q in questions if q.get('duplicate_count', 0) > 0),
            "primary_domain_count": primary_domain_count,
            "subdomain_count": subdomain_count,
            "questions_with_one_answer": questions_with_one_answer,
            "questions_with_no_answers": questions_with_no_answers,
            "questions_with_no_correct": questions_with_no_correct,
            "questions_flagged": questions_flagged
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

        # Pulisci i file root SOLO dopo migrazione riuscita
        # categories.json nella root (se esiste ancora)
        if old_categories_file.exists():
            try:
                old_categories_file.unlink()
                logger.info(f"  🗑️  Rimosso categories.json dalla root (già migrato)")
            except Exception as e:
                logger.warning(f"  ⚠️  Impossibile rimuovere categories.json: {e}")

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

def generate_self_signed_cert():
    """Genera certificato SSL self-signed se non esiste"""
    import ipaddress
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime
    
    cert_dir = Path(__file__).parent / 'certs'
    cert_dir.mkdir(exist_ok=True)
    
    cert_file = cert_dir / 'cert.pem'
    key_file = cert_dir / 'key.pem'
    
    if not cert_file.exists() or not key_file.exists():
        logger.info("🔐 Generazione certificato SSL self-signed...")
        
        # Genera chiave privata
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        
        # Crea soggetto e issuer (stessi per self-signed)
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, u"Question Lab"),
        ])
        
        # Crea certificato valido per 10 anni
        cert = x509.CertificateBuilder().subject_name(
            subject
        ).issuer_name(
            issuer
        ).public_key(
            private_key.public_key()
        ).serial_number(
            x509.random_serial_number()
        ).not_valid_before(
            datetime.datetime.utcnow()
        ).not_valid_after(
            datetime.datetime.utcnow() + datetime.timedelta(days=3650)
        ).add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName(u"localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                x509.IPAddress(ipaddress.IPv4Address("0.0.0.0")),
            ]),
            critical=False,
        ).sign(private_key, hashes.SHA256())
        
        # Salva chiave privata
        with open(key_file, "wb") as f:
            f.write(private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            ))
        
        # Salva certificato
        with open(cert_file, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        
        logger.info("✅ Certificato SSL generato correttamente")
    
    return (str(cert_file), str(key_file))

# Genera certificato se non esiste
cert_chain = generate_self_signed_cert()

# Crea contesto SSL che forza TLS 1.2 (risolve bug GREASE Chrome)
import ssl
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certfile=cert_chain[0], keyfile=cert_chain[1])
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.maximum_version = ssl.TLSVersion.TLSv1_2

# Avvia server con HTTPS e TLS 1.2 forzato
app.run(debug=True, host='0.0.0.0', port=5015, ssl_context=context)
