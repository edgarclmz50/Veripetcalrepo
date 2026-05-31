import couchdb

def setup_patrones_db():
    uris = [
        'http://admin:password123@localhost:5984/',
        'http://localhost:5984/',
    ]
    
    server = None
    
    for uri in uris:
        try:
            temp_server = couchdb.Server(uri)
            v = temp_server.version()
            print(f"Conexión exitosa a {uri} (Versión: {v})")
            server = temp_server
            break
        except Exception as e:
            pass # Keep trying
            
    if not server:
        print("No se pudo conectar a CouchDB.")
        return

    db_name = 'patrones'
    
    if db_name in server:
        db = server[db_name]
    else:
        try:
            db = server.create(db_name)
            print(f"Base de datos '{db_name}' creada.")
        except Exception as e:
            print(f"Error creando DB: {e}")
            return

    # --- 1. PATRÓN DE PRESIÓN ---
    patron_doc = {
        '_id': 'patron_001',
        'tipo': 'manometro',
        'alias': 'Manometro Patron Digital',
        'marca': 'Fluke',
        'modelo': '2700G',
        'serie': '12345678',
        'resolucion': 0.01,
        'incertidumbre_expandida': 0.05,
        'deriva': 0.02,
        'curva_calibracion': [
            {'indicacion': 0,    'correccion': 0.00},
            {'indicacion': 250,  'correccion': -0.01},
            {'indicacion': 500,  'correccion': 0.02},
            {'indicacion': 750,  'correccion': 0.01},
            {'indicacion': 1000, 'correccion': 0.03}
        ]
    }
    guardar_doc(db, patron_doc)

    # --- 2. TERMOHIGRÓMETRO (Para T y HR) ---
    termo_doc = {
        '_id': 'termo_001',
        'tipo': 'termohigrometro',
        'alias': 'Termohigrómetro Lab',
        'marca': 'Vaisala',
        'modelo': 'HM40',
        'incertidumbre_temp': 0.2, # °C (k=2)
        'incertidumbre_hr': 3.0,   # % (k=2)
        'deriva_temp': 0.05,
        'deriva_hr': 0.5
    }
    guardar_doc(db, termo_doc)

    # --- 3. BARÓMETRO (Para P atmosférica) ---
    baro_doc = {
        '_id': 'baro_001',
        'tipo': 'barometro',
        'alias': 'Barómetro Digital',
        'marca': 'Druck',
        'modelo': 'PACE',
        'incertidumbre_hpa': 1.0, # hPa (k=2)
        'deriva_hpa': 0.2
    }
    guardar_doc(db, baro_doc)

    # --- 4. FLUIDO (Aire/Nitrógeno) ---
    fluido_doc = {
        '_id': 'fluido_aire',
        'tipo': 'fluido',
        'nombre': 'Aire Ambiental',
        'composicion': 'Nitrogeno/Oxigeno',
        'metodo_densidad': 'CIPM-2007', # Indica que usaremos fórmula compleja
        'co2_ppm': 420
    }
    guardar_doc(db, fluido_doc)

def guardar_doc(db, doc):
    if doc['_id'] in db:
        existing = db[doc['_id']]
        existing.update(doc)
        db.save(existing)
        print(f"Documento '{doc['_id']}' actualizado.")
    else:
        db.save(doc)
        print(f"Documento '{doc['_id']}' insertado.")

if __name__ == '__main__':
    setup_patrones_db()
