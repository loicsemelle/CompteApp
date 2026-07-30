import io
import csv
import re
from datetime import datetime
from ofxparse import OfxParser

def guess_date_format(date_str):
    """
    Attempts to parse a date string and returns a standard YYYY-MM-DD string.
    Supports formats like DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY.
    """
    date_str = date_str.strip()
    # Try DD/MM/YYYY
    for pattern, fmt in [
        (r'^\d{2}/\d{2}/\d{4}$', '%d/%m/%Y'),
        (r'^\d{4}-\d{2}-\d{2}$', '%Y-%m-%d'),
        (r'^\d{2}-\d{2}-\d{4}$', '%d-%m-%Y')
    ]:
        if re.match(pattern, date_str):
            try:
                return datetime.strptime(date_str, fmt).strftime('%Y-%m-%d')
            except ValueError:
                pass
    
    # Fallback to general parsing if pattern didn't match perfectly
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%y'):
        try:
            return datetime.strptime(date_str, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
            
    raise ValueError(f"Impossible de parser la date : {date_str}")

def parse_french_float(val):
    """
    Parses a float string that might contain spaces as thousands separators
    and a comma as a decimal separator (French format).
    """
    if not val:
        return 0.0
    val_clean = val.strip().replace('\xa0', '').replace(' ', '')
    val_clean = val_clean.replace(',', '.')
    # Remove currency symbols or extra chars
    val_clean = re.sub(r'[^\d\.\-]', '', val_clean)
    return float(val_clean)

def parse_ofx(file_content_bytes):
    """
    Parses an OFX file content and returns a dictionary with transactions and account info.
    """
    f = io.BytesIO(file_content_bytes)
    ofx = OfxParser.parse(f)
    
    transactions = []
    account_info = None
    
    if ofx.accounts:
        acc = ofx.accounts[0]
        # Map account type
        acc_type = "courant"
        ofx_type_str = str(getattr(acc, 'account_type', '')).upper() or str(getattr(acc, 'type', '')).upper()
        if "SAVINGS" in ofx_type_str or "LIVRET" in ofx_type_str or "SAVING" in ofx_type_str:
            acc_type = "livret"
        elif "INVEST" in ofx_type_str or "SECURITIES" in ofx_type_str:
            acc_type = "investissement"
            
        balance = 0.0
        if hasattr(acc, 'statement') and hasattr(acc.statement, 'balance'):
            try:
                balance = float(acc.statement.balance or 0.0)
            except (ValueError, TypeError):
                pass
                
        account_info = {
            "id": getattr(acc, 'account_id', "") or getattr(acc, 'number', ""),
            "label": f"Compte {getattr(acc, 'account_id', '') or 'Importé'}",
            "type": acc_type,
            "balance": balance
        }
        
    for account in ofx.accounts:
        if hasattr(account, 'statement') and hasattr(account.statement, 'transactions'):
            for transaction in account.statement.transactions:
                tr_date = transaction.date.strftime('%Y-%m-%d') if transaction.date else ''
                label = getattr(transaction, 'payee', '') or getattr(transaction, 'memo', '') or ""
                label = label.strip()
                
                transactions.append({
                    "date": tr_date,
                    "label": label,
                    "amount": float(transaction.amount),
                    "fitid": getattr(transaction, 'id', None) or ""
                })
            
    return {
        "transactions": transactions,
        "account_info": account_info
    }

def parse_csv(file_content_bytes):
    """
    Parses a CSV file content with automatic column detection.
    """
    # Decode content
    try:
        text = file_content_bytes.decode('utf-8')
    except UnicodeDecodeError:
        text = file_content_bytes.decode('latin-1')
        
    lines = text.splitlines()
    if not lines:
        return []
        
    # Detect delimiter
    first_few_lines = "\n".join(lines[:5])
    delimiter = ';'
    if ',' in first_few_lines and first_few_lines.count(',') > first_few_lines.count(';'):
        delimiter = ','
    elif '\t' in first_few_lines:
        delimiter = '\t'
        
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = list(reader)
    
    # Filter empty rows
    rows = [r for r in rows if r and any(cell.strip() for cell in r)]
    
    # Tente de trouver la ligne d'en-tête
    header_row_index = -1
    date_col = -1
    label_col = -1
    amount_col = -1
    
    # Key word maps
    date_keywords = ('date', 'opération', 'operation', 'valeur')
    label_keywords = ('libellé', 'libelle', 'label', 'texte', 'description', 'motif')
    amount_keywords = ('montant', 'valeur', 'amount', 'somme', 'débit', 'crédit', 'debit', 'credit')
    
    for idx, row in enumerate(rows[:10]):
        row_lower = [cell.strip().lower() for cell in row]
        # Check if this row looks like a header row
        has_date = any(any(kw in cell for kw in date_keywords) for cell in row_lower)
        has_label = any(any(kw in cell for kw in label_keywords) for cell in row_lower)
        has_amount = any(any(kw in cell for kw in amount_keywords) for cell in row_lower)
        
        if has_date and (has_label or has_amount):
            header_row_index = idx
            break
            
    if header_row_index != -1:
        # We found the header row, let's identify column indices
        header_row = [cell.strip().lower() for cell in rows[header_row_index]]
        for col_idx, cell in enumerate(header_row):
            if date_col == -1 and any(kw in cell for kw in ('date opération', 'date operation', 'date op', 'date')):
                date_col = col_idx
            elif label_col == -1 and any(kw in cell for kw in label_keywords):
                label_col = col_idx
            elif amount_col == -1 and any(kw in cell for kw in amount_keywords) and 'date' not in cell:
                amount_col = col_idx
        
        # Fallback if specific phrase match was not found
        if date_col == -1:
            for col_idx, cell in enumerate(header_row):
                if any(kw in cell for kw in date_keywords):
                    date_col = col_idx
                    break
        if amount_col == -1:
            for col_idx, cell in enumerate(header_row):
                if any(kw in cell for kw in amount_keywords) and 'date' not in cell:
                    amount_col = col_idx
                    break
                    
        data_rows = rows[header_row_index + 1:]
    else:
        # Header not found, try to guess columns based on data types in the first row
        data_rows = rows
        # Guess date_col, amount_col, label_col by examining first few rows
        for test_row in data_rows[:3]:
            for col_idx, cell in enumerate(test_row):
                cell_strip = cell.strip()
                # Check for date pattern
                if date_col == -1 and re.match(r'^\d{2}[/\-]\d{2}[/\-]\d{4}$|^\d{4}-\d{2}-\d{2}$', cell_strip):
                    date_col = col_idx
                # Check for float amount pattern
                elif amount_col == -1:
                    try:
                        parse_french_float(cell_strip)
                        # Ensure it's not a year or zip code
                        if not re.match(r'^\d{4}$|^\d{5}$', cell_strip):
                            amount_col = col_idx
                    except ValueError:
                        pass
            if date_col != -1 and amount_col != -1:
                break
                
        # Guess label_col as the first non-date, non-amount column with text
        for col_idx in range(len(data_rows[0])):
            if col_idx != date_col and col_idx != amount_col:
                label_col = col_idx
                break
                
    # If we couldn't even guess columns, abort
    if date_col == -1 or amount_col == -1 or label_col == -1:
        raise ValueError("Impossible de détecter automatiquement les colonnes (date, libellé, montant) du fichier CSV.")
        
    transactions = []
    for r in data_rows:
        if len(r) <= max(date_col, label_col, amount_col):
            continue
        try:
            tr_date = guess_date_format(r[date_col])
            label = r[label_col].strip()
            amount = parse_french_float(r[amount_col])
            
            # Skip rows with no amount or label
            if not label or amount == 0.0:
                continue
                
            transactions.append({
                "date": tr_date,
                "label": label,
                "amount": amount,
                "fitid": "" # CSV has no fitid
            })
        except Exception:
            # Skip invalid lines (e.g. totals or empty lines)
            continue
            
    return transactions
