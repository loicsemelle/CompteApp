import unittest
import sqlite3
from app.db import save_manual_account, get_accounts

class TestManualAccount(unittest.TestCase):
    
    def test_save_manual_account(self):
        # Insert a manual account
        save_manual_account(
            account_id="HELLO_TEST",
            label="Hello Bank Test",
            account_type="courant",
            initial_balance=100.0
        )
        
        # Verify it was inserted
        accounts = get_accounts()
        matching = [acc for acc in accounts if acc['id'] == 'HELLO_TEST']
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['label'], "Hello Bank Test")
        self.assertEqual(matching[0]['type'], "courant")
        self.assertEqual(matching[0]['balance'], 100.0)

if __name__ == '__main__':
    unittest.main()
