import sqlite3
from functools import wraps

from flask import current_app, redirect, session
from werkzeug.security import generate_password_hash


ALLOWED_GRADES = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "E"]

SUBJECTS = {
    "ENG": "English",
    "KIS": "Kiswahili",
    "MAT": "Mathematics",
    "BIO": "Biology",
    "CHE": "Chemistry",
    "PHY": "Physics",
    "GSC": "General Science",
    "HAG": "History & Government",
    "GEO": "Geography",
    "CRE": "CRE",
    "IRE": "IRE",
    "HRE": "HRE",
    "CMP": "Computer Studies",
    "AGR": "Agriculture",
    "ARD": "Art & Design",
    "HSC": "Home Science",
    "BST": "Business Studies",
    "FRE": "French",
    "GER": "German",
    "MUS": "Music",
    "ARB": "Arabic",
}

SUBJECT_NORMALIZATION = {
    "ENGLISH": "ENG",
    "KISWAHILI": "KIS",
    "MATHEMATICS": "MAT",
    "MATH": "MAT",
    "BIOLOGY": "BIO",
    "CHEMISTRY": "CHE",
    "PHYSICS": "PHY",
    "GENERAL SCIENCE": "GSC",
    "HISTORY": "HAG",
    "HISTORY & GOVERNMENT": "HAG",
    "GEOGRAPHY": "GEO",
    "CRE": "CRE",
    "IRE": "IRE",
    "HRE": "HRE",
    "COMPUTER STUDIES": "CMP",
    "AGRICULTURE": "AGR",
    "ART & DESIGN": "ARD",
    "HOME SCIENCE": "HSC",
    "BUSINESS STUDIES": "BST",
    "FRENCH": "FRE",
    "GERMAN": "GER",
    "MUSIC": "MUS",
    "ARABIC": "ARB",
}


def db(row_factory=False):
    conn = sqlite3.connect(current_app.config["DATABASE_PATH"])
    if row_factory:
        conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    c = conn.cursor()

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cluster INTEGER NOT NULL
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS requirements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            subject TEXT NOT NULL,
            grade TEXT NOT NULL
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS universities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            cutoff REAL NOT NULL
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checkout_request_id TEXT UNIQUE NOT NULL,
            merchant_request_id TEXT,
            phone_number TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL,
            result_code INTEGER,
            result_desc TEXT,
            mpesa_receipt TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.commit()
    conn.close()


def create_default_admin():
    conn = db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM admins")

    if c.fetchone()[0] == 0:
        username = current_app.config["DEFAULT_ADMIN_USERNAME"]
        password = current_app.config["DEFAULT_ADMIN_PASSWORD"]
        c.execute(
            "INSERT INTO admins (username, password) VALUES (?, ?)",
            (username, generate_password_hash(password)),
        )

    conn.commit()
    conn.close()


def parse_requirements_text(requirements_input):
    rows = []
    for line in requirements_input.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        subject_part, grade_part = line.split(":", 1)
        subject = subject_part.strip()
        grade = grade_part.strip().upper()
        if not subject or grade not in ALLOWED_GRADES:
            continue
        rows.append((subject, grade))
    return rows


def parse_universities_and_cutoffs(universities_input, cutoffs_input):
    rows = []
    universities = universities_input.splitlines()
    cutoffs = cutoffs_input.splitlines()

    for uni, cutoff in zip(universities, cutoffs):
        uni_name = uni.strip()
        if not uni_name:
            continue
        try:
            cutoff_value = float(cutoff.strip())
        except ValueError:
            continue
        rows.append((uni_name, cutoff_value))
    return rows


def admin_required(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not session.get("admin"):
            return redirect("/admin")
        return f(*args, **kwargs)

    return wrapped


def check_subject_requirements(student_grades, requirements):
    grade_order = {
        "A": 12,
        "A-": 11,
        "B+": 10,
        "B": 9,
        "B-": 8,
        "C+": 7,
        "C": 6,
        "C-": 5,
        "D+": 4,
        "D": 3,
        "D-": 2,
        "E": 1,
    }

    clean_grades = {}
    for k, v in student_grades.items():
        if v and str(v).strip():
            clean_grades[k.strip().upper()] = str(v).strip().upper()

    failed = []
    for requirement, required_grade in requirements.items():
        required_grade = str(required_grade).strip().upper()
        if required_grade not in grade_order:
            continue

        options = []
        for s in str(requirement).split("/"):
            key = s.strip().upper()
            options.append(SUBJECT_NORMALIZATION.get(key, key))

        met = False
        matched_subject = None
        matched_grade = None

        for subject in options:
            if subject not in clean_grades:
                continue
            student_grade = clean_grades[subject]
            if grade_order.get(student_grade, 0) >= grade_order[required_grade]:
                met = True
                break
            matched_subject = subject
            matched_grade = student_grade

        if not met:
            failed.append(
                {
                    "subject": requirement,
                    "required": required_grade,
                    "student_subject": matched_subject,
                    "student_grade": matched_grade,
                }
            )

    return {"passed": len(failed) == 0, "failed": failed}
