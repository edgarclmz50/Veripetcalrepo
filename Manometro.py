import sys
import math
import statistics
try:
    import couchdb
except ImportError:
    print("\nError CRÍTICO: No se encontró el módulo 'couchdb'.")
    print("Esto suele ocurrir si no se está usando el entorno virtual configurado.")
    print("Intente ejecutar con: .venv\\Scripts\\python.exe Manometro.py")
    print("O instale la dependencia: pip install couchdb\n")
    sys.exit(1)
import random
import csv
import datetime

# ==============================================================================
# CLASE DE CÁLCULO DE DENSIDAD DEL AIRE (CIPM-2007)
# ==============================================================================
class AireCIPM:
    R = 8.314472        
    Mv = 0.01801528     
    AbsZero = 273.15    

    @staticmethod
    def psv_cipm(t_k):
        t2 = t_k * t_k
        exp_val = (1.2378847 * 10**-5 * t2) - (1.9121316 * 10**-2 * t_k) + 33.93711047 - (6343.1645 / t_k)
        return math.exp(exp_val)

    @staticmethod
    def factor_f(p_pa, t_k):
        t_c = t_k - 273.15
        alpha = 1.00062
        beta = 3.14 * 10**-8
        gamma = 5.6 * 10**-7
        return alpha + beta * p_pa + gamma * (t_c**2)

    @staticmethod
    def factor_z(p_pa, t_k, xv):
        t_c = t_k - 273.15
        ma0, ma1, ma2 = 1.58123e-6, -2.9331e-8, 1.1043e-10
        mb0, mb1 = 5.707e-6, -2.051e-8
        mc0, mc1 = 1.9898e-4, -2.376e-6
        term_air = ma0 + ma1 * t_c + ma2 * t_c**2
        term_water = mb0 + mb1 * t_c
        term_mix = mc0 + mc1 * t_c
        z_correction = (p_pa / t_k) * (term_air + xv * (term_water - term_air) + xv**2 * term_mix)
        return 1 - z_correction

    @classmethod
    def calcular_densidad(cls, t_c, p_pa, hr_percent, x_co2_ppm=420):
        t_k = t_c + cls.AbsZero
        x_co2 = x_co2_ppm * 10**-6
        psv = cls.psv_cipm(t_k)
        f = cls.factor_f(p_pa, t_k)
        xv = (hr_percent / 100) * f * psv / p_pa
        z = cls.factor_z(p_pa, t_k, xv)
        ma = (28.96546 + 12.011 * (x_co2 - 0.0004)) * 10**-3
        rho = (p_pa * ma) / (z * cls.R * t_k) * (1 - xv * (1 - cls.Mv / ma))
        return rho

    @classmethod
    def calcular_incertidumbre(cls, t_c, p_pa, hr, u_t_cert, u_p_cert, u_hr_cert, k=2):
        u_std_t = u_t_cert / k
        u_std_p = u_p_cert / k
        u_std_hr = u_hr_cert / k
        rho_nom = cls.calcular_densidad(t_c, p_pa, hr)
        delta = 0.0001
        c_t = (cls.calcular_densidad(t_c + delta, p_pa, hr) - rho_nom) / delta
        c_p = (cls.calcular_densidad(t_c, p_pa + delta, hr) - rho_nom) / delta
        c_hr = (cls.calcular_densidad(t_c, p_pa, hr + delta) - rho_nom) / delta
        u_c = math.sqrt((c_t * u_std_t)**2 + (c_p * u_std_p)**2 + (c_hr * u_std_hr)**2)
        return u_c

# ==============================================================================
# GESTOR DE UNIDADES
# ==============================================================================
class ConversorUnidades:
    FACTORES_KPA = {
        'kpa': 1.0,
        'pa': 0.001,
        'hpa': 0.1,
        'mpa': 1000.0,
        'psi': 6.89476,
        'bar': 100.0,
        'mbar': 0.1,
        'kgf/cm2': 98.0665,
        'mmhg': 0.133322,
        'inhg': 3.38639
    }

    @staticmethod
    def normalizar(valor_origen, unidad_origen, unidad_destino='kpa'):
        u_in = unidad_origen.lower().strip()
        u_out = unidad_destino.lower().strip()
        
        factor_in = ConversorUnidades.FACTORES_KPA.get(u_in)
        factor_out = ConversorUnidades.FACTORES_KPA.get(u_out)
        
        if factor_in is None:
            print(f"Advertencia: Unidad desconocida '{u_in}', asumiendo 1:1")
            return valor_origen
        if factor_out is None:
            print(f"Advertencia: Unidad destino desconocida '{u_out}', asumiendo kPa")
            factor_out = 1.0

        # Convertir a kPa luego a destino
        valor_kpa = valor_origen * factor_in
        return valor_kpa / factor_out

# ==============================================================================
# CLASE PRINCIPAL
# ==============================================================================

class CalibracionPresion:
    def __init__(self, datos_instrumento, equipos_ids, condiciones_ambientales, parametros_calculo, db_connection=None):
        self.inst = datos_instrumento
        self.env = condiciones_ambientales
        self.params = parametros_calculo
        self.resultados = []
        
        # Conexión DB
        if db_connection:
            self.db = db_connection
        else:
            self.couch = couchdb.Server('http://admin:password123@localhost:5984/')
            self.db = self.couch['patrones']
        
        # Cargar equipos
        try:
            self.patron_presion = self.db[equipos_ids['presion']]
            self.patron_termo = self.db[equipos_ids['termo']]
            self.patron_baro = self.db[equipos_ids['baro']]
            self.fluido = self.db[equipos_ids['fluido']]
        except couchdb.http.ResourceNotFound as e:
            print(f"Error: Equipo no encontrado en BD: {e}")
            raise

        self.rho_aire, self.u_rho_aire = self.calcular_propiedades_aire()
        
        # Detectar unidades
        self.unidad_inst = self.inst.get('unidad', 'kPa')
        self.unidad_patron = self.patron_presion.get('unidad', 'psi')

    def calcular_propiedades_aire(self):
        t = self.env.get('temperatura', 20.0)
        p_hpa = self.env.get('presion_atmosferica_hpa', 1013.25)
        hr = self.env.get('humedad_relativa', 50.0)
        
        u_t = self.patron_termo.get('incertidumbre_temp', 0.5)
        u_hr = self.patron_termo.get('incertidumbre_hr', 3.0)
        u_p_hpa = self.patron_baro.get('incertidumbre_hpa', 1.0)
        
        ppm_co2 = self.fluido.get('co2_ppm', 420)
        p_pa = p_hpa * 100 
        u_p_pa = u_p_hpa * 100
        metodo = self.fluido.get('metodo_densidad', 'CIPM-2007')
        
        if metodo == 'CIPM-2007':
            rho = AireCIPM.calcular_densidad(t, p_pa, hr, ppm_co2)
            u_rho = AireCIPM.calcular_incertidumbre(t, p_pa, hr, u_t, u_p_pa, u_hr)
        else:
            rho = 1.2; u_rho = 0.01
        return rho, u_rho

    def correccion_altura(self):
        """ Retorna corrección en la UNIDAD DEL INSTRUMENTO """
        g = self.env.get('gravedad', 9.77) 
        rho = self.rho_aire
        delta_h_m = (self.env['altura_patron_mm'] - self.env['altura_inst_mm']) / 1000
        
        # Fórmula base da Pa (kg/m3 * m/s2 * m)
        presion_columna_pa = (delta_h_m * rho * g)
        
        # Convertir Pa -> Unidad Instrumento
        return ConversorUnidades.normalizar(presion_columna_pa, 'pa', self.unidad_inst)

    def calcular_incertidumbre_altura(self):
        """ Retorna incertidumbre en la UNIDAD DEL INSTRUMENTO """
        g = self.env.get('gravedad', 9.77)
        rho = self.rho_aire
        u_rho = self.u_rho_aire
        delta_h_m = abs(self.env['altura_patron_mm'] - self.env['altura_inst_mm']) / 1000
        if delta_h_m == 0: delta_h_m = 0.001 
        u_h_m = self.env.get('incertidumbre_regla_mm', 1.0) / 1000
        
        c_rho = g * delta_h_m
        uc_rho = c_rho * u_rho
        c_h = rho * g
        uc_h = c_h * u_h_m
        
        u_comb_pa = math.sqrt(uc_rho**2 + uc_h**2)
        return ConversorUnidades.normalizar(u_comb_pa, 'pa', self.unidad_inst)

    def calcular_correccion_patron_curva(self, lectura_nominal):
        """ 
        Retorna corrección en UNIDAD DEL INSTRUMENTO.
        Entrada: lectura_nominal (en unidad instrumento).
        """
        # 1. Convertir la lectura nominal a la unidad del patrón para interpolar
        lectura_en_patron = ConversorUnidades.normalizar(lectura_nominal, self.unidad_inst, self.unidad_patron)
        
        curva = self.patron_presion.get('curva_calibracion', [])
        corr_en_patron = 0.0
        
        if curva:
            curva.sort(key=lambda x: x['indicacion'])
            
            # Interpolación
            encontrado = False
            for i in range(len(curva) - 1):
                p1 = curva[i]; p2 = curva[i+1]
                if p1['indicacion'] <= lectura_en_patron <= p2['indicacion']:
                    m = (p2['correccion'] - p1['correccion']) / (p2['indicacion'] - p1['indicacion'])
                    corr_en_patron = p1['correccion'] + m * (lectura_en_patron - p1['indicacion'])
                    encontrado = True
                    break
            if not encontrado:
                if lectura_en_patron < curva[0]['indicacion']: corr_en_patron = curva[0]['correccion']
                elif lectura_en_patron > curva[-1]['indicacion']: corr_en_patron = curva[-1]['correccion']
        
        # 2. Convertir la corrección hallada (que está en unidad patrón) a unidad instrumento
        return ConversorUnidades.normalizar(corr_en_patron, self.unidad_patron, self.unidad_inst)

    def calcular_efecto_temperatura(self, lectura_actual):
        rm_percent = self.params.get('rm', 0.004) 
        temp_lab = self.env.get('temperatura', 20.0)
        delta_temp = abs(temp_lab - 20.0)
        if delta_temp == 0: delta_temp = 1.0 
        variacion = lectura_actual * (rm_percent / 100) * delta_temp
        return variacion / math.sqrt(3)

    def convertir_incertidumbre_patron_a_inst(self, u_patron):
        return ConversorUnidades.normalizar(u_patron, self.unidad_patron, self.unidad_inst)

    def procesar_punto(self, presion_nominal, lecturas_asc, lecturas_desc):
        """
        Todo el cálculo se realiza en la unidad del instrumento (self.unidad_inst).
        Las lecturas simuladas ya vienen en esa unidad.
        """
        todas_lecturas = lecturas_asc + lecturas_desc
        promedio_lectura = statistics.mean(todas_lecturas)
        n = len(todas_lecturas)

        # Correcciones (ya convertidas a unidad inst)
        corr_patron = self.calcular_correccion_patron_curva(presion_nominal)
        corr_h = self.correccion_altura()
        
        # Modelo Matemático: P_ref = P_nom + C_pat + C_h
        presion_ref = presion_nominal + corr_patron + corr_h 
        error = promedio_lectura - presion_ref

        # Incertidumbres (Todas en unidad inst)
        if n > 1:
            u_rep = statistics.stdev(todas_lecturas) / math.sqrt(n)
        else:
            u_rep = 0

        u_res_inst = self.inst['resolucion'] / (2 * math.sqrt(3))
        
        # Resolución Patrón (Convertir)
        res_pat_orig = self.patron_presion.get('resolucion', 0.001)
        res_pat_conv = ConversorUnidades.normalizar(res_pat_orig, self.unidad_patron, self.unidad_inst)
        u_res_pat = res_pat_conv / (2 * math.sqrt(3))

        # Histéresis
        prom_asc = statistics.mean(lecturas_asc)
        prom_desc = statistics.mean(lecturas_desc)
        u_histe = abs(prom_asc - prom_desc) / (2 * math.sqrt(3))

        # Certificado Patrón (Convertir)
        u_cert_orig = self.patron_presion.get('incertidumbre_expandida', 0)
        u_cert_conv = ConversorUnidades.normalizar(u_cert_orig, self.unidad_patron, self.unidad_inst)
        u_patron_cert = u_cert_conv / 2 

        # Deriva Patrón (Convertir)
        deriva_orig = self.patron_presion.get('deriva', 0)
        deriva_conv = ConversorUnidades.normalizar(deriva_orig, self.unidad_patron, self.unidad_inst)
        u_deriva = deriva_conv / math.sqrt(3)
        
        u_altura = self.calcular_incertidumbre_altura()
        u_temp = self.calcular_efecto_temperatura(promedio_lectura)

        suma_cuadrados = (u_rep**2 + u_res_inst**2 + u_res_pat**2 + 
                          u_histe**2 + u_patron_cert**2 + u_deriva**2 + 
                          u_altura**2 + u_temp**2)
        
        u_combinada = math.sqrt(suma_cuadrados)
        U_expandida = u_combinada * 2 

        return {
            'Punto Nominal': presion_nominal,
            'Lectura Promedio': promedio_lectura,
            'Ref. Corregida': presion_ref,
            'Error': error,
            'U Exp': U_expandida,
            'Unidad': self.unidad_inst
        }

    def evaluar_conformidad(self, rango_max, clase_exactitud):
        emp = (clase_exactitud * rango_max) / 100
        resultados_enriquecidos = []
        for row in self.resultados:
            val_evaluar = abs(row['Error']) + row['U Exp']
            if val_evaluar <= emp:
                conformidad = "ACEPTADO"
            else:
                conformidad = "RECHAZADO (*)"
            new_row = row.copy()
            new_row['EMP'] = emp
            new_row['Conformidad'] = conformidad
            resultados_enriquecidos.append(new_row)
        return resultados_enriquecidos

def planificar_calibracion(clase_exactitud, rango_max):
    plan = {}
    if clase_exactitud >= 0.6:
        plan['secuencia'] = 'C'; plan['ciclos'] = 1
        porcentajes = [0, 25, 50, 75, 100]
    elif 0.1 <= clase_exactitud < 0.6:
        plan['secuencia'] = 'B'; plan['ciclos'] = 1
        porcentajes = range(0, 101, 10)
    else: 
        plan['secuencia'] = 'A (Alta Exactitud)'; plan['ciclos'] = 2
        porcentajes = range(0, 101, 10)
    plan['puntos'] = [(p / 100) * rango_max for p in porcentajes]
    return plan

def simular_lecturas(plan, error_sistematico=0.15, ruido=0.05):
    datos_simulados = []
    for p in plan['puntos']:
        lecturas_asc = []
        lecturas_desc = []
        for _ in range(plan['ciclos']):
            l_a = p + error_sistematico + random.uniform(-ruido, ruido)
            l_d = p + error_sistematico + random.uniform(-ruido, ruido) - 0.02
            lecturas_asc.append(round(l_a, 2))
            lecturas_desc.append(round(l_d, 2))
        datos_simulados.append((p, lecturas_asc, lecturas_desc))
    return datos_simulados

def obtener_patrones_disponibles(db):
    try:
        patrones = []
        for doc_id in db:
            doc = db[doc_id]
            if doc.get('tipo') == 'manometro' or 'curva_calibracion' in doc:
                patrones.append(doc)
        return patrones
    except Exception as e:
        print(f"Error listando patrones: {e}")
        return []

def seleccionar_patron_cli(db):
    patrones = obtener_patrones_disponibles(db)
    if not patrones:
        print("No se encontraron patrones en la base de datos.")
        return None
    print("\n--- SELECCIÓN DE PATRÓN DE PRESIÓN ---")
    print(f"{'#':<3} {'Código':<18} {'Marca/Modelo':<30} {'Unidad'}")
    print("-" * 70)
    for i, p in enumerate(patrones):
        alias = p.get('alias', 'Sin Alias')[:30]
        unidad = p.get('unidad', 'N/A')
        print(f"{i+1:<3} {p['_id']:<18} {alias:<30} {unidad}")
    print("-" * 70)
    while True:
        try:
            sel = input(f"Seleccione número (1-{len(patrones)}): ")
            idx = int(sel) - 1
            if 0 <= idx < len(patrones):
                return patrones[idx]['_id']
            else: print("Número inválido.")
        except ValueError: print("Entrada inválida.")
        except KeyboardInterrupt: sys.exit(0)

def guardar_resultados_csv(resultados):
    filename = 'resultados_calibracion.csv'
    if not resultados: return
    try:
        keys = resultados[0].keys()
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            dict_writer = csv.DictWriter(f, fieldnames=keys)
            dict_writer.writeheader()
            dict_writer.writerows(resultados)
        print(f"\nResultados guardados en '{filename}'")
    except Exception as e:
        print(f"Error guardando CSV: {e}")

# --- EJECUCIÓN ---

if __name__ == "__main__":
    couch = couchdb.Server('http://admin:password123@localhost:5984/')
    db = couch['patrones']

    patron_id = None
    if len(sys.argv) > 1: patron_id = sys.argv[1]
    if not patron_id: patron_id = seleccionar_patron_cli(db)
    if not patron_id: sys.exit(1)

    # CONFIGURACIÓN INSTRUMENTO (Aquí definimos su unidad)
    # Ejemplo: Instrumento en psi, pero podríamos poner kPa
    inst = {'rango_max': 1000.0, 'resolucion': 0.1, 'clase': 0.1, 'unidad': 'psi'}
    
    plan = planificar_calibracion(inst['clase'], inst['rango_max'])
    datos = simular_lecturas(plan)

    equipos = {
        'presion': patron_id,
        'termo': 'termo_001',
        'baro': 'baro_001',
        'fluido': 'fluido_aire'
    }
    
    env = {
        'temperatura': 23.5,            
        'presion_atmosferica_hpa': 960, 
        'humedad_relativa': 45.0,
        'altura_patron_mm': 100,                              
        'altura_inst_mm': 0, 
        'incertidumbre_regla_mm': 1.0,                        
        'gravedad': 9.77
    }
    parametros = {'rm': 0.004}

    print("\nIniciando Cálculo con Conversión de Unidades...")
    try:
        app = CalibracionPresion(inst, equipos, env, parametros, db_connection=db)
    except Exception as e:
        print(f"Error fatal inicializando: {e}")
        exit()

    print(f"\n--- CONFIGURACIÓN ---")
    print(f"Patrón: {app.patron_presion.get('alias')} [{app.unidad_patron}]")
    print(f"Instrumento: {inst['rango_max']} {app.unidad_inst}")
    print(f"Densidad Aire: {app.rho_aire:.4f} kg/m3")
    print("-" * 60)

    for p, asc, desc in datos:
        app.resultados.append(app.procesar_punto(p, asc, desc))

    resultados = app.evaluar_conformidad(inst['rango_max'], inst['clase'])

    print("-" * 110)
    header = f"{'Punto':<10} {'Promedio':<10} {'Ref.Real':<10} {'Error':<10} {'U Exp':<10} {'Conformidad':<15}"
    print(header)
    print("-" * 110)

    for row in resultados:
        print(f"{row['Punto Nominal']:<10.4f} {row['Lectura Promedio']:<10.4f} {row['Ref. Corregida']:<10.4f} {row['Error']:<10.4f} {row['U Exp']:<10.4f} {row['Conformidad']:<15}")

    guardar_resultados_csv(resultados)