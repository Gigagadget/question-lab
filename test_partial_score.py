#!/usr/bin/env python3
"""
Test that partial scores work correctly end-to-end
"""

import json
from pathlib import Path
import sys
sys.path.insert(0, '.')

from modules.quiz_utils import QuizManager

# Create test database with a question that has 4 correct answers
test_db = [
    {
        "id": "test_partial",
        "raw_text": "Domanda con 4 risposte corrette",
        "answers": {
            "A": "Risposta A", 
            "B": "Risposta B",
            "C": "Risposta C",
            "D": "Risposta D",
            "E": "Risposta E",
            "F": "Risposta F"
        },
        "correct": ["A", "B", "C", "D"],
        "primary_domain": "Test",
        "subdomain": "Test"
    }
]

test_db_path = Path("test_partial.json")
with open(test_db_path, "w") as f:
    json.dump(test_db, f)

qm = QuizManager(str(test_db_path), quiz_log_dir="./test_logs")

print("Testing partial answer scoring:\n")

# Test case 1: 1/4 correct answers selected, no wrong
result = qm.validate_answer("test_partial", ["A"])
print(f"1/4 correct, 0 wrong:")
print(f"  score: {result['score']} → {round(result['score']*100)}%")
print(f"  is_partial: {result['is_partial']}")
print(f"  feedback: {result['feedback']}")

# Test case 2: 2/4 correct answers selected, no wrong
result = qm.validate_answer("test_partial", ["A", "B"])
print(f"\n2/4 correct, 0 wrong:")
print(f"  score: {result['score']} → {round(result['score']*100)}%")
print(f"  is_partial: {result['is_partial']}")
print(f"  feedback: {result['feedback']}")

# Test case 3: 3/4 correct answers selected, no wrong
result = qm.validate_answer("test_partial", ["A", "B", "C"])
print(f"\n3/4 correct, 0 wrong:")
print(f"  score: {result['score']} → {round(result['score']*100)}%")
print(f"  is_partial: {result['is_partial']}")
print(f"  feedback: {result['feedback']}")

# Test case 4: 2/4 correct + 1 wrong selected
result = qm.validate_answer("test_partial", ["A", "B", "E"])
print(f"\n2/4 correct, 1 wrong:")
print(f"  score: {result['score']} → {round(result['score']*100)}%")
print(f"  is_partial: {result['is_partial']}")
print(f"  feedback: {result['feedback']}")

# Test case 5: All 4 correct selected
result = qm.validate_answer("test_partial", ["A", "B", "C", "D"])
print(f"\n4/4 correct:")
print(f"  score: {result['score']} → {round(result['score']*100)}%")
print(f"  is_correct: {result['is_correct']}")
print(f"  feedback: {result['feedback']}")

# Cleanup
test_db_path.unlink()
import shutil
shutil.rmtree("./test_logs", ignore_errors=True)

print("\n✅ All tests completed")
