"""Create a test SQLite database with realistic manufacturing + sales data."""

import sqlite3
import random
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "test_factory.db")


def create_db():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # ── TABLES ──────────────────────────────────────────────

    c.execute("""
        CREATE TABLE machines (
            machine_id INTEGER PRIMARY KEY,
            machine_name TEXT NOT NULL,
            machine_type TEXT NOT NULL,
            location TEXT NOT NULL,
            installed_date TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE production_logs (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id INTEGER REFERENCES machines(machine_id),
            production_date TEXT NOT NULL,
            shift TEXT NOT NULL,
            planned_time_min REAL NOT NULL,
            run_time_min REAL NOT NULL,
            ideal_cycle_time_sec REAL NOT NULL,
            total_count INTEGER NOT NULL,
            good_count INTEGER NOT NULL,
            downtime_min REAL NOT NULL,
            downtime_reason TEXT
        )
    """)

    c.execute("""
        CREATE TABLE products (
            product_id INTEGER PRIMARY KEY,
            product_name TEXT NOT NULL,
            category TEXT NOT NULL,
            unit_price REAL NOT NULL,
            unit_cost REAL NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_date TEXT NOT NULL,
            product_id INTEGER REFERENCES products(product_id),
            quantity INTEGER NOT NULL,
            total_amount REAL NOT NULL,
            discount REAL DEFAULT 0,
            status TEXT NOT NULL,
            customer_region TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE monthly_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL
        )
    """)

    # ── SEED DATA ───────────────────────────────────────────

    # Machines
    machines = [
        (1, "CNC Mill A1", "CNC", "Chicago-Line1", "2022-01-15"),
        (2, "CNC Mill A2", "CNC", "Chicago-Line1", "2022-03-20"),
        (3, "Lathe B1", "Lathe", "Chicago-Line2", "2021-06-10"),
        (4, "Press C1", "Press", "Detroit-Line1", "2023-02-01"),
        (5, "Press C2", "Press", "Detroit-Line1", "2023-02-01"),
        (6, "Assembly D1", "Assembly", "Detroit-Line2", "2020-11-15"),
    ]
    c.executemany("INSERT INTO machines VALUES (?,?,?,?,?)", machines)

    # Production logs — 6 months of daily data for each machine
    random.seed(42)
    downtime_reasons = [
        "Equipment Failure", "Setup/Adjustment", "Material Shortage",
        "Operator Break", "Quality Hold", "Preventive Maintenance", None
    ]

    for machine_id in range(1, 7):
        base_date = datetime(2024, 7, 1)
        for day in range(180):  # July-Dec 2024
            date = base_date + timedelta(days=day)
            if date.weekday() >= 6:  # skip Sundays
                continue
            for shift in ["Morning", "Afternoon", "Night"]:
                planned = 480  # 8 hours
                downtime = random.uniform(5, 90)
                run_time = planned - downtime
                cycle_time = random.uniform(20, 60)
                total = int(run_time * 60 / cycle_time)
                defect_rate = random.uniform(0.005, 0.05)
                good = int(total * (1 - defect_rate))
                reason = random.choice(downtime_reasons) if downtime > 30 else None

                c.execute(
                    "INSERT INTO production_logs "
                    "(machine_id, production_date, shift, planned_time_min, run_time_min, "
                    "ideal_cycle_time_sec, total_count, good_count, downtime_min, downtime_reason) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (machine_id, date.strftime("%Y-%m-%d"), shift, planned, round(run_time, 1),
                     round(cycle_time, 1), total, good, round(downtime, 1), reason),
                )

    # Products
    products = [
        (1, "Widget Pro", "Electronics", 49.99, 18.50),
        (2, "Widget Lite", "Electronics", 29.99, 11.00),
        (3, "Gadget X", "Accessories", 79.99, 32.00),
        (4, "Gadget Mini", "Accessories", 39.99, 15.50),
        (5, "Sensor Pack", "Components", 149.99, 55.00),
        (6, "Cable Kit", "Components", 19.99, 6.50),
    ]
    c.executemany("INSERT INTO products VALUES (?,?,?,?,?)", products)

    # Orders — 12 months
    statuses = ["completed", "completed", "completed", "completed", "shipped", "cancelled", "returned"]
    regions = ["North", "South", "East", "West"]

    for month in range(1, 13):
        num_orders = random.randint(80, 150)
        for _ in range(num_orders):
            day = random.randint(1, 28)
            date = f"2024-{month:02d}-{day:02d}"
            prod = random.choice(products)
            qty = random.randint(1, 20)
            discount = random.choice([0, 0, 0, 5, 10, 15])
            total = round(prod[3] * qty * (1 - discount / 100), 2)
            status = random.choice(statuses)
            region = random.choice(regions)
            c.execute(
                "INSERT INTO orders (order_date, product_id, quantity, total_amount, discount, status, customer_region) "
                "VALUES (?,?,?,?,?,?,?)",
                (date, prod[0], qty, total, discount, status, region),
            )

    # Monthly expenses
    expense_cats = [
        ("Raw Materials", 45000, 65000),
        ("Labor", 80000, 95000),
        ("Utilities", 12000, 18000),
        ("Maintenance", 8000, 15000),
        ("Marketing", 20000, 35000),
        ("R&D", 15000, 25000),
    ]
    for month in range(1, 13):
        for cat, lo, hi in expense_cats:
            amt = round(random.uniform(lo, hi), 2)
            c.execute(
                "INSERT INTO monthly_expenses (month, category, amount) VALUES (?,?,?)",
                (f"2024-{month:02d}", cat, amt),
            )

    conn.commit()

    # Print summary
    for table in ["machines", "production_logs", "products", "orders", "monthly_expenses"]:
        count = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {count} rows")

    conn.close()
    print(f"\nDatabase created at: {DB_PATH}")


if __name__ == "__main__":
    create_db()
