#!/usr/bin/env python3
"""
Debug script to verify score is returned correctly from API
"""

import json
from pathlib import Path
import sys
sys.path.insert(0, '.')

from modules.quiz_utils import QuizManager

# Use actual database path
db_path = Path("database.json")
if not db_path.exists():
    print("Database not found, creating test one")
    test_db = [
        {
            "id": "test1",
            "raw_text": "Domanda con 2 risposte corrette",
            "answers": {"A": "Risposta A", "B": "Risposta B", "C": "Risposta C", "D": "Risposta D"},
            "correct": ["A", "B"],
            "primary_domain": "Test",
            "subdomain": "Test"
        }
    ]
    with open(db_path, "w") as f:
        json.dump(test_db, f)

qm = QuizManager(str(db_path), quiz_log_dir="./debug_logs")

print("Testing validate_answer with partial correct only:")
result = qm.validate_answer("test1", ["A"])
print(f"\nResult:")
print(f"  is_correct: {result['is_correct']}")
print(f"  is_partial: {result['is_partial']}")
print(f"  score: {result['score']}")
print(f"  score type: {type(result['score'])}")
print(f"  feedback: {result['feedback']}")

print("\n" + "="*50)
print("Testing with 2/3 correct answers:")

# Find a question with 3 correct answers
questions = qm.load_database()
for q in questions:
    correct = q.get('correct', [])
    valid_correct = [c for c in correct if c and c != 'null' and c.strip()]
    if len(valid_correct) == 3:
        print(f"\nFound question {q['id']} with 3 correct answers: {valid_correct}")
        result = qm.validate_answer(q['id'], valid_correct[:2])
        print(f"Result:")
        print(f"  is_correct: {result['is_correct']}")
        print(f"  is_partial: {result['is_partial']}")
        print(f"  score: {result['score']}")
        print(f"  score type: {type(result['score'])}")
        print(f"  feedback: {result['feedback']}")
        break
else:
    print("No question with 3 correct answers found")

import shutil
shutil.rmtree("./debug_logs", ignore_errors=True)
