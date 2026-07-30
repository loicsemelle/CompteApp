import unittest
import sqlite3
from app.db import get_db_connection, save_account, rename_account

class TestRenameAccount(unittest.TestCase):
    
    def setUp(self):
        self.conn = get_db_connection()
        self.cursor = self.conn.cursor()
        
        # Ensure test account is absent
        self.cursor.execute("DELETE FROM accounts WHERE id = 'ACC_RENAME_TEST'")
        self.conn.commit()
        
    def tearDown(self):
        self.cursor.execute("DELETE FROM accounts WHERE id = 'ACC_RENAME_TEST'")
        self.conn.commit()
        self.conn.close()
        
    def test_rename_and_preservation_on_sync(self):
        # 1. First sync inserts the account
        save_account(
            account_id="ACC_RENAME_TEST",
            backend_name="test_backend",
            label="Original Bank Name",
            balance=500.0,
            account_type="courant"
        )
        
        # Verify it was inserted
        self.cursor.execute("SELECT label FROM accounts WHERE id = 'ACC_RENAME_TEST'")
        self.assertEqual(self.cursor.fetchone()["label"], "Original Bank Name")
        
        # 2. User renames the account
        rename_account("ACC_RENAME_TEST", "My Custom Label")
        
        # Verify renaming works
        self.cursor.execute("SELECT label FROM accounts WHERE id = 'ACC_RENAME_TEST'")
        self.assertEqual(self.cursor.fetchone()["label"], "My Custom Label")
        
        # 3. Next sync runs, tries to insert again with original bank name
        save_account(
            account_id="ACC_RENAME_TEST",
            backend_name="test_backend",
            label="Original Bank Name",
            balance=600.0, # balance updated
            account_type="courant"
        )
        
        # Verify balance is updated but user's label is preserved!
        self.cursor.execute("SELECT label, balance FROM accounts WHERE id = 'ACC_RENAME_TEST'")
        row = self.cursor.fetchone()
        self.assertEqual(row["label"], "My Custom Label")
        self.assertEqual(row["balance"], 600.0)

if __name__ == '__main__':
    unittest.main()
