import psycopg2

# ---- PostgreSQL connection ----
conn = psycopg2.connect(
    host="localhost",
    database="bill_analysis",
    user="postgres",
    password="postgrespl1234",
    port="5432"
)

print("Database connected successfully ✅")

conn.close()