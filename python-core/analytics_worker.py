# Path: python-core/analytics_worker.py
import sqlite3
import json
import time
import os
from datetime import datetime, timedelta

DB_FILE = "sora_events.db"


def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            event_type TEXT,
            session_id TEXT,
            payload TEXT
        )
    ''')
    conn.commit()
    conn.close()


# Initialize DB on module import
init_db()


def record_event(event_type: str, session_id: str, payload: dict):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "INSERT INTO events (timestamp, event_type, session_id, payload) VALUES (?, ?, ?, ?)",
        (time.time(), event_type, session_id, json.dumps(payload))
    )
    conn.commit()
    conn.close()
    return "Event recorded"


def get_stats(days: int = 7):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    cutoff = time.time() - (days * 24 * 60 * 60)

    query = '''
        SELECT 
            date(datetime(timestamp, 'unixepoch')) as day,
            event_type,
            COUNT(*) as count
        FROM events
        WHERE timestamp > ?
        GROUP BY day, event_type
        ORDER BY day DESC
    '''

    c.execute(query, (cutoff,))
    rows = c.fetchall()
    conn.close()

    stats = {}
    for day, ev_type, count in rows:
        if day not in stats:
            stats[day] = {}
        stats[day][ev_type] = count

    return stats


def get_top_sessions(limit: int = 5):
    """
    Повертає сесії з найбільшою кількістю скачувань.
    """
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Вважаємо, що успішне скачування = подія 'download' або 'download_success'
    query = '''
        SELECT session_id, COUNT(*) as count
        FROM events
        WHERE event_type IN ('download', 'download_success')
        GROUP BY session_id
        ORDER BY count DESC
        LIMIT ?
    '''
    c.execute(query, (limit,))
    rows = c.fetchall()
    conn.close()

    return [{"sessionId": row[0], "downloaded": row[1]} for row in rows]