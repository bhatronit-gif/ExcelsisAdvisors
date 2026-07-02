# server.py
import sqlite3
import json
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Excelsis Audit Server", version="2.0")

# Enable CORS so local HTML file can fetch from http://localhost:8000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
import os
DATABASE_DIR = "/data" if os.path.exists("/data") else "."
DATABASE_FILE = os.path.join(DATABASE_DIR, "audit_database.db")

# Initialize SQLite database
def init_db():
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school TEXT,
            auditor TEXT,
            date TEXT,
            score REAL,
            audit_data TEXT,
            last_updated TEXT,
            UNIQUE(school, date)
        )
    """)
    conn.commit()
    conn.close()

init_db()

# Pydantic schema for audit payloads
class AuditPayload(BaseModel):
    school: str
    auditor: str
    date: str
    score: float
    audit_data: dict

@app.get("/")
def read_root():
    return {"status": "Excelsis Audit Server is running", "database": DATABASE_FILE}

# Get list of all saved audits (history)
@app.get("/api/history")
def get_history():
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT school, auditor, date, score, last_updated 
            FROM audits 
            ORDER BY last_updated DESC
        """)
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for r in rows:
            history.append({
                "school": r[0],
                "auditor": r[1],
                "date": r[2],
                "score": r[3],
                "last_updated": r[4]
            })
        return history
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Save or update an audit (upsert)
@app.post("/api/save")
def save_audit(payload: AuditPayload):
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Convert audit_data dict to JSON string for SQLite
        data_json = json.dumps(payload.audit_data)
        
        cursor.execute("""
            INSERT INTO audits (school, auditor, date, score, audit_data, last_updated)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(school, date) DO UPDATE SET
                auditor=excluded.auditor,
                score=excluded.score,
                audit_data=excluded.audit_data,
                last_updated=excluded.last_updated
        """, (payload.school, payload.auditor, payload.date, payload.score, data_json, now_str))
        
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Audit for {payload.school} on {payload.date} saved successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Load a specific audit record
@app.get("/api/load")
def load_audit(school: str, date: str):
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT auditor, score, audit_data 
            FROM audits 
            WHERE school = ? AND date = ?
        """, (school, date))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail="Audit record not found")
            
        return {
            "auditor": row[0],
            "score": row[1],
            "audit_data": json.loads(row[2])
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

# Delete a specific audit record
@app.delete("/api/delete")
def delete_audit(school: str, date: str):
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM audits 
            WHERE school = ? AND date = ?
        """, (school, date))
        conn.commit()
        
        deleted_count = cursor.rowcount
        conn.close()
        
        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="Audit record not found to delete")
            
        return {"status": "success", "message": f"Audit for {school} on {date} deleted."}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
