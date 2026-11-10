import json
import psycopg2
from shapely.geometry import shape

# 1. Load your GeoJSON file
with open("C:\\Users\\default.LAPTOP-J5GV1TT8\\Downloads\\export_1.geojson", "r", encoding="utf-8") as f:
    geojson_data = json.load(f)

# 2. Connect to your Supabase PostgreSQL instance
# Replace with your actual Supabase connection string
DB_CONNECTION = ""

conn = psycopg2.connect(DB_CONNECTION)
cursor = conn.cursor()

try:
    # 3. Loop through features and insert them
    for feature in geojson_data["features"]:
        properties = feature.get("properties", {})
        name = properties.get("name", "Unnamed Feature") # Change 'name' to a key in your properties if needed
        
        # Convert the GeoJSON geometry to a Shapely object, then to WKT (Well-Known Text)
        geom_shape = shape(feature["geometry"])
        wkt_geom = geom_shape.wkt

        # Insert query using PostGIS ST_GeomFromText
        insert_query = """
            INSERT INTO app_locations.supermarkets (name, properties, geom)
            VALUES (%s, %s, ST_GeomFromText(%s, 4326))
        """
        
        cursor.execute(insert_query, (name, json.dumps(properties), wkt_geom))
    
    conn.commit()
    print("Successfully uploaded all features to Supabase!")

except Exception as e:
    print(f"An error occurred: {e}")
    conn.rollback()

finally:
    cursor.close()
    conn.close()