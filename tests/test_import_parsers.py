import unittest
from app.importer import guess_date_format, parse_french_float, parse_csv, parse_ofx

class TestImportParsers(unittest.TestCase):
    
    def test_guess_date_format(self):
        self.assertEqual(guess_date_format("22/07/2026"), "2026-07-22")
        self.assertEqual(guess_date_format("2026-07-22"), "2026-07-22")
        self.assertEqual(guess_date_format("22-07-2026"), "2026-07-22")
        self.assertEqual(guess_date_format("  22/07/2026  "), "2026-07-22")
        
    def test_parse_french_float(self):
        self.assertEqual(parse_french_float("123.45"), 123.45)
        self.assertEqual(parse_french_float("123,45"), 123.45)
        self.assertEqual(parse_french_float("-1 234,56"), -1234.56)
        self.assertEqual(parse_french_float("  -43,55 € "), -43.55)
        self.assertEqual(parse_french_float(""), 0.0)
        
    def test_parse_csv(self):
        csv_data = (
            "Date opération;Date valeur;Libellé;Montant;Devise\n"
            "17/07/2026;16/07/2026;E.Leclerc WEB;-71,89;EUR\n"
            "20/07/2026;17/07/2026;E.Leclerc CB;-17,17;EUR\n"
        ).encode('utf-8')
        
        txs = parse_csv(csv_data)
        self.assertEqual(len(txs), 2)
        self.assertEqual(txs[0]['date'], "2026-07-17")
        self.assertEqual(txs[0]['label'], "E.Leclerc WEB")
        self.assertEqual(txs[0]['amount'], -71.89)
        self.assertEqual(txs[1]['date'], "2026-07-20")
        self.assertEqual(txs[1]['label'], "E.Leclerc CB")
        self.assertEqual(txs[1]['amount'], -17.17)

    def test_parse_csv_no_header(self):
        csv_data = (
            "17/07/2026;E.Leclerc WEB;-71,89\n"
            "20/07/2026;E.Leclerc CB;-17,17\n"
        ).encode('utf-8')
        
        txs = parse_csv(csv_data)
        self.assertEqual(len(txs), 2)
        self.assertEqual(txs[0]['date'], "2026-07-17")
        self.assertEqual(txs[0]['label'], "E.Leclerc WEB")
        self.assertEqual(txs[0]['amount'], -71.89)

    def test_parse_ofx(self):
        ofx_data = (
            "OFXHEADER:100\n"
            "DATA:OFXSGML\n"
            "VERSION:102\n"
            "SECURITY:NONE\n"
            "ENCODING:USASCII\n"
            "CHARSET:1252\n"
            "<OFX>\n"
            "<BANKMSGSRSV1>\n"
            "<STMTTRNRS>\n"
            "<STMTRS>\n"
            "<CURDEF>EUR</CURDEF>\n"
            "<BANKACCTFROM>\n"
            "<BANKID>12345</BANKID>\n"
            "<ACCTID>987654321</ACCTID>\n"
            "<ACCTTYPE>CHECKING</ACCTTYPE>\n"
            "</BANKACCTFROM>\n"
            "<BANKTRANLIST>\n"
            "<STMTTRN>\n"
            "<TRNTYPE>DEBIT</TRNTYPE>\n"
            "<DTPOSTED>20260717120000</DTPOSTED>\n"
            "<TRNAMT>-71.89</TRNAMT>\n"
            "<FITID>FIT123</FITID>\n"
            "<NAME>E.Leclerc WEB</NAME>\n"
            "</STMTTRN>\n"
            "</BANKTRANLIST>\n"
            "<LEDGERBAL>\n"
            "<BALAMT>1500.00</BALAMT>\n"
            "<DTASOF>20260717120000</DTASOF>\n"
            "</LEDGERBAL>\n"
            "</STMTRS>\n"
            "</STMTTRNRS>\n"
            "</BANKMSGSRSV1>\n"
            "</OFX>\n"
        ).encode('utf-8')
        
        res = parse_ofx(ofx_data)
        self.assertIsNotNone(res["account_info"])
        self.assertEqual(res["account_info"]["id"], "987654321")
        self.assertEqual(res["account_info"]["type"], "courant")
        self.assertEqual(res["account_info"]["balance"], 1500.0)
        self.assertEqual(len(res["transactions"]), 1)
        self.assertEqual(res["transactions"][0]["label"], "E.Leclerc WEB")
        self.assertEqual(res["transactions"][0]["amount"], -71.89)

if __name__ == '__main__':
    unittest.main()
