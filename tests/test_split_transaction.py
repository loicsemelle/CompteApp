import unittest
import sqlite3
from app.db import get_db_connection, split_transaction

class TestSplitTransaction(unittest.TestCase):
    
    def setUp(self):
        self.conn = get_db_connection()
        self.cursor = self.conn.cursor()
        
        # Insert a dummy account
        self.cursor.execute("""
        INSERT OR IGNORE INTO accounts (id, backend_name, label, balance, type, last_sync, include_in_budget_and_list)
        VALUES ('ACC_TEST', 'Manuel', 'Test Account', 1000.0, 'courant', '2026-07-27', 1)
        """)
        
        # Insert a dummy transaction of -100.00 EUR
        self.cursor.execute("""
        INSERT OR IGNORE INTO transactions (id, account_id, date, rdate, label, amount, type, category, note, checked, decalage, sync_timestamp, coming)
        VALUES ('TX_PARENT', 'ACC_TEST', '2026-07-27', '2026-07-27', 'Supermarket', -100.00, 'Dépense variable', 'Autre', '', 0, 0, '2026-07-27 12:00:00', 0)
        """)
        self.conn.commit()
        
    def tearDown(self):
        self.cursor.execute("DELETE FROM transactions WHERE id = 'TX_PARENT' OR id LIKE 'TX_PARENT_split_%'")
        self.cursor.execute("DELETE FROM accounts WHERE id = 'ACC_TEST'")
        self.conn.commit()
        self.conn.close()
        
    def test_split_transaction_success(self):
        parts = [
            {"amount": -70.00, "category": "Courses alimentaires", "note": "Food part"},
            {"amount": -30.00, "category": "Transports", "note": "Fuel part"}
        ]
        
        split_transaction("TX_PARENT", parts)
        
        # Fetch updated parent
        self.cursor.execute("SELECT amount, category, note FROM transactions WHERE id = 'TX_PARENT'")
        parent = self.cursor.fetchone()
        self.assertEqual(parent["amount"], -70.00)
        self.assertEqual(parent["category"], "Courses alimentaires")
        self.assertEqual(parent["note"], "Food part")
        
        # Fetch child part
        self.cursor.execute("SELECT amount, category, note, label FROM transactions WHERE id = 'TX_PARENT_split_2'")
        child = self.cursor.fetchone()
        self.assertIsNotNone(child)
        self.assertEqual(child["amount"], -30.00)
        self.assertEqual(child["category"], "Transports")
        self.assertEqual(child["note"], "Fuel part")
        self.assertEqual(child["label"], "Supermarket (Part 2)")
        
    def test_split_transaction_invalid_sum(self):
        parts = [
            {"amount": -70.00, "category": "Courses alimentaires", "note": "Food part"},
            {"amount": -40.00, "category": "Transports", "note": "Fuel part"} # Sum = -110.00
        ]
        
        with self.assertRaises(ValueError):
            split_transaction("TX_PARENT", parts)

if __name__ == '__main__':
    unittest.main()
