import csv
try:
    import couchdb
except ImportError:
    print("\nError CRÍTICO: No se encontró el módulo 'couchdb'.")
    print("Esto suele ocurrir si no se está usando el entorno virtual configurado.")
    print("Intente ejecutar con: .venv\\Scripts\\python.exe import_csv_patrones.py")
    print("O instale la dependencia: pip install couchdb\n")
    import sys
    sys.exit(1)
import io

def parse_float(val):
    if not val: return 0.0
    val = val.strip()
    # Lógica robusta para formato numérico
    # Caso 1: 1.234,56 (Euro/Latam) -> . es mil, , es decimal
    if '.' in val and ',' in val:
        val = val.replace('.', '').replace(',', '.')
    # Caso 2: 1234,56 (Latam simple) -> , es decimal
    elif ',' in val:
        val = val.replace(',', '.')
    # Caso 3: 1234.56 (US simple) -> asumir float directo
    
    try:
        return float(val)
    except:
        return 0.0

def import_csv_to_couchdb():
    csv_path = 'FORMATO4.csv'
    
    couch = couchdb.Server('http://admin:password123@localhost:5984/')
    db_name = 'patrones'
    if db_name not in couch:
        couch.create(db_name)
    db = couch[db_name]

    patrones = {}

    print(f"Leyendo {csv_path}...")

    # Leer todo el contenido para encontrar la cabecera
    # Probar unicode o latin-1
    content = ""
    try:
        with open(csv_path, 'r', encoding='latin-1') as f:
            content = f.read()
    except:
        with open(csv_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
    lines = content.splitlines()
    
    # Encontrar índice de la cabecera
    header_idx = -1
    for i, line in enumerate(lines):
        if 'Descripción' in line or 'Marca' in line and 'Modelo' in line:
            header_idx = i
            break
            
    if header_idx == -1:
        print("No se encontró la fila de cabecera.")
        return

    # Crear DictReader desde la línea de cabecera
    # Unir las líneas desde header_idx y pasarlas a un StringIO para csv
    valid_csv_str = "\n".join(lines[header_idx:])
    f_io = io.StringIO(valid_csv_str)
    
    reader = csv.DictReader(f_io, delimiter=';')
    
    rows_processed = 0
    for row in reader:
        # Clave única
        codigo = row.get('Código', '').strip()
        if not codigo: continue 

        # Inicializar objeto si es nuevo
        if codigo not in patrones:
            clase_txt = row.get('CL', '').replace('±', '').replace('% FS', '').strip().replace(',', '.')
            try:
                clase_val = float(clase_txt)
            except:
                clase_val = 0.05 

            # Inferir Tipo y Parámetro basado en Descripción y Unidad
            desc = row.get('Descripción', '').lower()
            unidad = row.get('Unidad', '').lower()
            
            tipo = 'manometro' # Default
            param = 'Presión'
            
            if 'termo' in desc or 'higro' in desc or 'temp' in desc or 'humedad' in desc:
                tipo = 'termohigrometro'
                param = 'Ambiental'
            elif 'bomba' in desc or 'generador' in desc or 'handheld' in desc or 'fuente' in desc:
                tipo = 'fuente_presion'
                param = 'Generación Presión'
            elif 'balanza' in desc:
                tipo = 'balanza'
                param = 'Masa/Presión'
            
            # Ajuste fino por unidad si descripción es ambigua
            if '°' in unidad or 'hz' in unidad or '%' in unidad:
                 if tipo == 'manometro': 
                     tipo = 'termohigrometro' # Corrección
                     param = 'Ambiental'

            patrones[codigo] = {
                '_id': codigo, 
                'tipo': tipo,
                'alias': f"{row.get('Descripción', 'Equipo')} {row.get('Marca', '')}",
                'marca': row.get('Marca', ''),
                'modelo': row.get('Modelo', ''),
                'serie': row.get('No. Serie', ''),
                'codigo_interno': codigo,
                'certificado': row.get('Certificado', ''),
                'fecha_calibracion': row.get('Fecha Cal', ''),
                'parametro': param,
                'unidad': row.get('Unidad', 'psi').strip(),
                'clase_exactitud': clase_val,
                'curva_calibracion': [],
                'incertidumbre_maxima': 0.0,
                'deriva_maxima': 0.0,
                'resolucion': 0.0 # Se recalculará
            }

        # Extraer punto de calibración
        try:
            # LI=Indicación, LP/Rango=Ref? 
            # El usuario usó "LI" y "Corrección".
            indicacion = parse_float(row.get('LI', '0'))
            correccion = parse_float(row.get('Corrección', '0'))
            u_punto = parse_float(row.get('U', '0'))
            deriva = parse_float(row.get('Deriva', '0'))
            
            punto = {
                'indicacion': indicacion,
                'correccion': correccion,
                'u_expandida': u_punto,
                'deriva': deriva
            }
            patrones[codigo]['curva_calibracion'].append(punto)
            
            # Estadísticas globales
            if u_punto > patrones[codigo]['incertidumbre_maxima']:
                patrones[codigo]['incertidumbre_maxima'] = u_punto
                patrones[codigo]['incertidumbre_expandida'] = u_punto
                
            if deriva > patrones[codigo]['deriva_maxima']:
                patrones[codigo]['deriva_maxima'] = deriva
                patrones[codigo]['deriva'] = deriva
            
            rows_processed += 1
                
        except Exception as e:
            print(f"Propagando error en fila de código {codigo}: {e}")

    # Guardar en CouchDB
    print(f"Encontrados {len(patrones)} equipos (procesadas {rows_processed} filas de calibración).")
    
    count = 0
    for codigo, doc in patrones.items():
        # Heurística para resolución: buscar el número con más decimales en la "LI" del CSV original?
        # O simplemente asumir algo razonable.
        doc['resolucion'] = 0.001 # Valor por defecto mejorado
        
        # Eliminar campos temporales si se quiere
        if codigo in db:
            existing = db[codigo]
            rev = existing.pop('_rev')
            doc['_rev'] = rev
            db.save(doc)
            print(f"Actualizado: {doc['alias']} ({codigo})")
        else:
            db.save(doc)
            print(f"Insertado: {doc['alias']} ({codigo})")
        count += 1
        
    print(f"Importación finalizada.")

if __name__ == '__main__':
    import_csv_to_couchdb()
