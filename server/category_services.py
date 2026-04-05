"""
Servizi per la gestione delle categorie.
Logica di dominio per: impact preview, merge, health dashboard.
"""

import logging
from difflib import SequenceMatcher

from server.utils import (
    DEFAULT_PRIMARY_DOMAIN,
    DEFAULT_SUBDOMAIN,
    normalize_categories_structure,
    _normalize_category_value,
)

logger = logging.getLogger(__name__)

# Soglia minima per similarità testuale (0-1)
SIMILARITY_THRESHOLD = 0.75


def _count_questions_for_primary(questions, primary_domain):
    """Conta le domande con un dato primary_domain."""
    return sum(1 for q in questions if q.get('primary_domain') == primary_domain)


def _count_questions_for_subdomain(questions, primary_domain, subdomain):
    """Conta le domande con una data coppia primary/subdomain."""
    return sum(
        1 for q in questions
        if q.get('primary_domain') == primary_domain and q.get('subdomain') == subdomain
    )


def _get_sample_question_ids(questions, primary_domain=None, subdomain=None, max_samples=20):
    """Restituisce un campione di ID domande filtrati per categoria."""
    samples = []
    for q in questions:
        if primary_domain and q.get('primary_domain') != primary_domain:
            continue
        if subdomain and q.get('subdomain') != subdomain:
            continue
        samples.append(q.get('id'))
        if len(samples) >= max_samples:
            break
    return samples


def _text_similarity(a, b):
    """Calcola similarità testuale tra due stringhe (0-1)."""
    a_norm = (a or '').lower().strip()
    b_norm = (b or '').lower().strip()
    if not a_norm or not b_norm:
        return 0.0
    return SequenceMatcher(None, a_norm, b_norm).ratio()


def _find_similar_pairs(items, threshold=SIMILARITY_THRESHOLD):
    """Trova coppie di elementi con similarità sopra la soglia."""
    pairs = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            sim = _text_similarity(items[i], items[j])
            if sim >= threshold:
                pairs.append({
                    "item_a": items[i],
                    "item_b": items[j],
                    "similarity": round(sim, 3)
                })
    return pairs


def preview_category_impact(questions, operation, category_type, value, **kwargs):
    """
    Calcola l'impatto di un'operazione su una categoria (dry-run).

    Args:
        questions: lista di domande dal database
        operation: 'rename' | 'remove' | 'merge'
        category_type: 'primary_domain' | 'subdomain'
        value: nome della categoria sorgente
        kwargs:
            - new_value: per rename/merge (target)
            - primary_domain: contesto per subdomain operations

    Returns:
        dict con:
            - affected_questions_count
            - affected_by_primary: dict {primary_domain: count}
            - sample_question_ids
            - would_fallback_to_default_count
            - warnings: lista di stringhe
    """
    if not questions:
        return {
            "affected_questions_count": 0,
            "affected_by_primary": {},
            "sample_question_ids": [],
            "would_fallback_to_default_count": 0,
            "warnings": []
        }

    warnings = []
    affected_count = 0
    fallback_count = 0
    affected_by_primary = {}

    if category_type == 'primary_domain':
        # Conta domande per questo primary
        affected_count = _count_questions_for_primary(questions, value)
        sample_ids = _get_sample_question_ids(questions, primary_domain=value)
        affected_by_primary = {value: affected_count}

        if operation == 'remove':
            fallback_count = affected_count  # Tutte le domande vanno a indefinito
            if affected_count > 0:
                warnings.append(
                    f"{affected_count} domande verranno spostate su '{DEFAULT_PRIMARY_DOMAIN}/{DEFAULT_SUBDOMAIN}'"
                )

        elif operation == 'rename':
            new_value = kwargs.get('new_value', '').strip()
            if not new_value:
                return {"error": "new_value è obbligatorio per il rename"}
            # Verifica collisioni
            categories_data = normalize_categories_structure({}, questions=questions)
            if new_value in categories_data.get('primary_domains', []):
                warnings.append(f"Attentione: '{new_value}' esiste già")

        elif operation == 'merge':
            target = kwargs.get('new_value', '').strip()
            if not target:
                return {"error": "new_value (target) è obbligatorio per il merge"}
            if value == DEFAULT_PRIMARY_DOMAIN:
                warnings.append(f"Il dominio '{DEFAULT_PRIMARY_DOMAIN}' non può essere sorgente di merge")
            target_count = _count_questions_for_primary(questions, target)
            if target_count > 0:
                warnings.append(
                    f"Il target '{target}' ha già {target_count} domande: verranno unite"
                )
            # Dopo merge, tutte le domande di value andranno a target
            affected_by_primary = {value: affected_count, target: target_count}

    elif category_type == 'subdomain':
        primary_domain = kwargs.get('primary_domain', '').strip()
        categories_data = normalize_categories_structure({}, questions=questions)

        # Risolvi il primary se non fornito
        if not primary_domain:
            sub_map = categories_data.get('subdomains_by_primary', {})
            matching_primaries = [
                p for p, subs in sub_map.items() if value in subs
            ]
            if len(matching_primaries) == 1:
                primary_domain = matching_primaries[0]
            elif len(matching_primaries) > 1:
                warnings.append(
                    f"Sottodominio ambiguo: '{value}' esiste in {len(matching_primaries)} domini principali. "
                    f"Specificare primary_domain."
                )
                # Conta comunque per tutti i primaries
                for p in matching_primaries:
                    cnt = _count_questions_for_subdomain(questions, p, value)
                    if cnt > 0:
                        affected_by_primary[p] = cnt
                        affected_count += cnt
                sample_ids = _get_sample_question_ids(questions, subdomain=value)
                fallback_count = affected_count if operation == 'remove' else 0
                if operation == 'remove' and affected_count > 0:
                    warnings.append(
                        f"{affected_count} domande verranno impostate su subdomain='{DEFAULT_SUBDOMAIN}'"
                    )
                return {
                    "affected_questions_count": affected_count,
                    "affected_by_primary": affected_by_primary,
                    "sample_question_ids": sample_ids[:20],
                    "would_fallback_to_default_count": fallback_count,
                    "warnings": warnings
                }
            else:
                return {
                    "affected_questions_count": 0,
                    "affected_by_primary": {},
                    "sample_question_ids": [],
                    "would_fallback_to_default_count": 0,
                    "warnings": [f"Sottodominio '{value}' non trovato"]
                }

        # Ora abbiamo primary_domain risolto
        affected_count = _count_questions_for_subdomain(questions, primary_domain, value)
        sample_ids = _get_sample_question_ids(
            questions, primary_domain=primary_domain, subdomain=value
        )
        affected_by_primary = {primary_domain: affected_count} if affected_count > 0 else {}

        if operation == 'remove':
            fallback_count = affected_count
            if affected_count > 0:
                warnings.append(
                    f"{affected_count} domande in '{primary_domain}' verranno impostate su subdomain='{DEFAULT_SUBDOMAIN}'"
                )

        elif operation == 'rename':
            new_value = kwargs.get('new_value', '').strip()
            if not new_value:
                return {"error": "new_value è obbligatorio per il rename"}
            subs = categories_data.get('subdomains_by_primary', {}).get(primary_domain, [])
            if new_value in subs:
                warnings.append(f"Attentione: '{new_value}' esiste già come sottodominio di '{primary_domain}'")

        elif operation == 'merge':
            target = kwargs.get('new_value', '').strip()
            if not target:
                return {"error": "new_value (target) è obbligatorio per il merge"}
            if value == DEFAULT_SUBDOMAIN:
                warnings.append(f"Il sottodominio '{DEFAULT_SUBDOMAIN}' non può essere sorgente di merge")
            target_count = _count_questions_for_subdomain(questions, primary_domain, target)
            if target_count > 0:
                warnings.append(
                    f"Il target '{target}' ha già {target_count} domande in '{primary_domain}': verranno unite"
                )
            affected_by_primary = {
                primary_domain: affected_count,
                f"{primary_domain}/{target}": target_count
            }

    else:
        return {"error": f"Tipo categoria non valido: {category_type}"}

    return {
        "affected_questions_count": affected_count,
        "affected_by_primary": affected_by_primary,
        "sample_question_ids": sample_ids[:20],
        "would_fallback_to_default_count": fallback_count,
        "warnings": warnings
    }


def merge_categories(questions, category_type, source_value, target_value, primary_domain=None):
    """
    Unisce una categoria in un'altra.

    Args:
        questions: lista di domande dal database
        category_type: 'primary_domain' | 'subdomain'
        source_value: categoria da cui mergiare (sorgente)
        target_value: categoria in cui mergiare (target)
        primary_domain: obbligatorio per subdomain merge

    Returns:
        dict con:
            - success: bool
            - message: string
            - updated_questions: int
            - updated_questions_list: lista di ID aggiornati
            - merged_from: sorgente
            - merged_to: target
            - warnings: lista di warning
            - error: messaggio di errore (se fallisce)
    """
    warnings = []
    updated_count = 0
    updated_ids = []

    # Validazioni base
    if not source_value or not target_value:
        return {"success": False, "error": "source_value e target_value sono obbligatori"}
    if source_value == target_value:
        return {"success": False, "error": "Sorgente e target sono uguali"}

    categories_data = normalize_categories_structure({}, questions=questions)

    if category_type == 'primary_domain':
        # Non mergiare da indefinito
        if source_value == DEFAULT_PRIMARY_DOMAIN:
            return {
                "success": False,
                "error": f"Il dominio '{DEFAULT_PRIMARY_DOMAIN}' non può essere sorgente di merge"
            }

        # Verifica che source esista
        if source_value not in categories_data.get('primary_domains', []):
            return {"success": False, "error": f"Dominio sorgente '{source_value}' non trovato"}

        # Se target non esiste, crealo
        if target_value not in categories_data.get('primary_domains', []):
            categories_data['primary_domains'].append(target_value)
            categories_data['primary_domains'] = sorted(
                categories_data['primary_domains'], key=lambda v: v.lower()
            )
            if DEFAULT_SUBDOMAIN not in categories_data['subdomains_by_primary'].get(target_value, []):
                categories_data['subdomains_by_primary'][target_value] = [DEFAULT_SUBDOMAIN]
            warnings.append(f"Dominio target '{target_value}' creato")

        # Merge dei sottodomini: unisci i subdomain di source in target
        source_subs = categories_data.get('subdomains_by_primary', {}).get(source_value, [DEFAULT_SUBDOMAIN])
        target_subs = set(categories_data.get('subdomains_by_primary', {}).get(target_value, [DEFAULT_SUBDOMAIN]))

        for sub in source_subs:
            target_subs.add(sub)

        categories_data['subdomains_by_primary'][target_value] = sorted(
            target_subs, key=lambda v: v.lower()
        )
        if DEFAULT_SUBDOMAIN in categories_data['subdomains_by_primary'][target_value]:
            # Mantieni indefinito primo
            subs_list = categories_data['subdomains_by_primary'][target_value]
            subs_list.remove(DEFAULT_SUBDOMAIN)
            subs_list.insert(0, DEFAULT_SUBDOMAIN)
            categories_data['subdomains_by_primary'][target_value] = subs_list

        # Aggiorna domande: source -> target
        for q in questions:
            if q.get('primary_domain') == source_value:
                old_sub = q.get('subdomain', DEFAULT_SUBDOMAIN)
                q['primary_domain'] = target_value
                # Se il subdomain di source non esiste in target, fallback a indefinito
                target_subs_for_q = categories_data['subdomains_by_primary'].get(target_value, [DEFAULT_SUBDOMAIN])
                if old_sub not in target_subs_for_q:
                    q['subdomain'] = DEFAULT_SUBDOMAIN
                updated_count += 1
                updated_ids.append(q.get('id'))

        # Rimuovi source dalle categorie
        categories_data['primary_domains'] = [
            p for p in categories_data['primary_domains'] if p != source_value
        ]
        categories_data['subdomains_by_primary'].pop(source_value, None)

    elif category_type == 'subdomain':
        # Risolvi primary_domain
        if not primary_domain:
            sub_map = categories_data.get('subdomains_by_primary', {})
            matching_primaries = [
                p for p, subs in sub_map.items() if source_value in subs
            ]
            if len(matching_primaries) == 1:
                primary_domain = matching_primaries[0]
            elif len(matching_primaries) > 1:
                return {
                    "success": False,
                    "error": f"Sottodominio ambiguo: '{source_value}' esiste in più domini. Specifica primary_domain."
                }
            else:
                return {"success": False, "error": f"Sottodominio sorgente '{source_value}' non trovato"}

        if source_value == DEFAULT_SUBDOMAIN:
            return {
                "success": False,
                "error": f"Il sottodominio '{DEFAULT_SUBDOMAIN}' non può essere sorgente di merge"
            }

        subs = categories_data.get('subdomains_by_primary', {}).get(primary_domain, [])
        if source_value not in subs:
            return {"success": False, "error": f"Sottodominio '{source_value}' non trovato in '{primary_domain}'"}

        # Se target non esiste, aggiungilo
        if target_value not in subs:
            subs.append(target_value)
            categories_data['subdomains_by_primary'][primary_domain] = sorted(
                subs, key=lambda v: v.lower()
            )
            if DEFAULT_SUBDOMAIN in categories_data['subdomains_by_primary'][primary_domain]:
                subs_list = categories_data['subdomains_by_primary'][primary_domain]
                subs_list.remove(DEFAULT_SUBDOMAIN)
                subs_list.insert(0, DEFAULT_SUBDOMAIN)
                categories_data['subdomains_by_primary'][primary_domain] = subs_list
            warnings.append(f"Sottodominio target '{target_value}' aggiunto a '{primary_domain}'")

        # Aggiorna domande: source_sub -> target_sub nel primary
        for q in questions:
            if q.get('primary_domain') == primary_domain and q.get('subdomain') == source_value:
                q['subdomain'] = target_value
                updated_count += 1
                updated_ids.append(q.get('id'))

        # Rimuovi source dai subdomains
        subs = categories_data['subdomains_by_primary'].get(primary_domain, [])
        categories_data['subdomains_by_primary'][primary_domain] = [
            s for s in subs if s != source_value
        ]

    else:
        return {"success": False, "error": f"Tipo categoria non valido: {category_type}"}

    return {
        "success": True,
        "message": f"Merge completato: '{source_value}' -> '{target_value}'",
        "updated_questions": updated_count,
        "updated_questions_list": updated_ids,
        "merged_from": source_value,
        "merged_to": target_value,
        "warnings": warnings
    }


def get_categories_health(questions):
    """
    Analizza l'integrità della tassonomia categorie.

    Returns:
        dict con:
            - empty_primary_domains: lista di primary senza domande
            - unused_subdomains: lista di subdomain mai usati
            - top_primary_domains: [(name, count), ...] ordinato decrescente
            - top_subdomains: [(name, count), ...] ordinato decrescente
            - possible_duplicates: coppie con similarità testuale
            - suggestions: lista di azioni consigliate
            - total_questions: totale domande
            - total_primaries: numero di primary domains
            - total_subdomains: numero di subdomains unici
    """
    if not questions:
        return {
            "empty_primary_domains": [],
            "unused_subdomains": [],
            "top_primary_domains": [],
            "top_subdomains": [],
            "possible_duplicates": [],
            "suggestions": [],
            "total_questions": 0,
            "total_primaries": 0,
            "total_subdomains": 0
        }

    categories_data = normalize_categories_structure({}, questions=questions)
    primary_domains = categories_data.get('primary_domains', [])
    subdomains_by_primary = categories_data.get('subdomains_by_primary', {})

    # Conta per primary
    primary_counts = {}
    for p in primary_domains:
        primary_counts[p] = _count_questions_for_primary(questions, p)

    # Conta per subdomain (globale)
    subdomain_counts = {}
    for p, subs in subdomains_by_primary.items():
        for sub in subs:
            key = f"{p}/{sub}"
            subdomain_counts[key] = _count_questions_for_subdomain(questions, p, sub)

    # Primary vuote
    empty_primaries = [p for p, cnt in primary_counts.items() if cnt == 0 and p != DEFAULT_PRIMARY_DOMAIN]

    # Subdomain inutilizzati
    unused_subdomains = [
        key for key, cnt in subdomain_counts.items()
        if cnt == 0 and not key.endswith(f"/{DEFAULT_SUBDOMAIN}")
    ]

    # Top categories
    top_primaries = sorted(
        [(p, cnt) for p, cnt in primary_counts.items() if cnt > 0],
        key=lambda x: x[1],
        reverse=True
    )[:10]

    top_subdomains = sorted(
        [(sub, cnt) for sub, cnt in subdomain_counts.items() if cnt > 0],
        key=lambda x: x[1],
        reverse=True
    )[:10]

    # Possibili duplicati testuali
    possible_dupes_primaries = _find_similar_pairs(primary_domains)
    # Per subdomains, controlla all'interno di ogni primary
    possible_dupes_subdomains = []
    for p, subs in subdomains_by_primary.items():
        pairs = _find_similar_pairs(subs)
        for pair in pairs:
            pair["primary_domain"] = p
        possible_dupes_subdomains.extend(pairs)

    possible_duplicates = {
        "primary_domains": possible_dupes_primaries,
        "subdomains": possible_dupes_subdomains
    }

    # Suggerimenti
    suggestions = []
    if empty_primaries:
        suggestions.append({
            "type": "cleanup",
            "priority": "medium",
            "message": f"{len(empty_primaries)} domini principali vuoti: considera di rimuoverli",
            "details": empty_primaries
        })

    if unused_subdomains:
        suggestions.append({
            "type": "cleanup",
            "priority": "low",
            "message": f"{len(unused_subdomains)} sottodomini mai utilizzati: considera di rimuoverli",
            "details": unused_subdomains
        })

    if possible_dupes_primaries:
        suggestions.append({
            "type": "merge_candidate",
            "priority": "medium",
            "message": f"{len(possible_dupes_primaries)} coppie di domini simili: valuta un merge",
            "details": possible_dupes_primaries
        })

    if possible_dupes_subdomains:
        suggestions.append({
            "type": "merge_candidate",
            "priority": "low",
            "message": f"{len(possible_dupes_subdomains)} coppie di sottodomini simili: valuta un merge",
            "details": possible_dupes_subdomains
        })

    # Statistiche totali
    all_unique_subdomains = set()
    for subs in subdomains_by_primary.values():
        all_unique_subdomains.update(subs)

    return {
        "empty_primary_domains": empty_primaries,
        "unused_subdomains": unused_subdomains,
        "top_primary_domains": top_primaries,
        "top_subdomains": top_subdomains,
        "possible_duplicates": possible_duplicates,
        "suggestions": suggestions,
        "total_questions": len(questions),
        "total_primaries": len(primary_domains),
        "total_subdomains": len(all_unique_subdomains)
    }
