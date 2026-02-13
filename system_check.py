import inspect
import sqlite3

from app import create_app
from app import routes

DB = "kuccps.db"


def check_single_calculate():
    src = inspect.getsource(routes)
    count = src.count("def calculate")
    assert count == 1, f"Multiple calculate() functions found: {count}"
    print("Single calculate() function confirmed")


def check_calculate_route():
    src = inspect.getsource(routes.calculate)
    assert "CLUSTER_COURSES" not in src, "Static CLUSTER_COURSES used in calculate()"
    assert "cluster_courses" in src, "cluster_courses not built dynamically"
    print("calculate() route OK")


def check_database():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {t[0] for t in c.fetchall()}
    required = {"courses", "requirements", "universities"}
    missing = required - tables
    assert not missing, f"Missing tables: {missing}"
    print("Database tables OK")
    conn.close()


def run_all_checks():
    _ = create_app()
    print("\nRUNNING SYSTEM INTEGRITY CHECKS\n")
    check_single_calculate()
    check_calculate_route()
    check_database()
    print("\nALL CHECKS PASSED - SYSTEM IS CLEAN & SAFE\n")


if __name__ == "__main__":
    run_all_checks()
