"""
Módulo de cálculo metrológico para calibración de presión.
Contiene clases y utilidades independientes de la interfaz de usuario.
"""

import math
import statistics
import couchdb
import datetime
import numpy as np

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
            # print(f"Advertencia: Unidad desconocida '{u_in}', asumiendo 1:1")
            return valor_origen
        if factor_out is None:
            # print(f"Advertencia: Unidad destino desconocida '{u_out}', asumiendo kPa")
            factor_out = 1.0

        # Convertir a kPa luego a destino
        valor_kpa = valor_origen * factor_in
        return valor_kpa / factor_out

# ==============================================================================
# CLASE PRINCIPAL
# ==============================================================================

class CalibracionPresion:
    def __init__(self, datos_instrumento, equipos_db, condiciones_ambientales, parametros_calculo):
        """
        equipos_db: Diccionario con los documentos directos de los patrones, 
        NO los IDs. Esto desacopla la conexión DB de la lógica.
        """
        self.inst = datos_instrumento
        self.env = condiciones_ambientales
        self.params = parametros_calculo
        self.resultados = []
        
        # Cargar equipos directamente
        self.patron_presion = equipos_db.get('presion', {})
        self.patron_termo = equipos_db.get('termo', {})
        self.patron_baro = equipos_db.get('baro', {})
        self.fluido = equipos_db.get('fluido', {})
        
        # Cache de variables ambientales para no recalcular siempre
        self.rho_aire = 1.2
        self.u_rho_aire = 0.01
        self.rho_aire, self.u_rho_aire = self.calcular_propiedades_aire()

        # Detectar unidades
        self.unidad_inst = self.inst.get('unidad', 'kPa')
        self.unidad_patron = self.patron_presion.get('unidad', 'psi')
        self.u_zero_val = 0.0

    def set_patron_presion(self, nuevo_patron):
        """ Permite cambiar el patrón de presión activo dinámicamente (ej. vacío vs presión) """
        self.patron_presion = nuevo_patron
        
        # Actualizar unidad patrón
        self.unidad_patron = self.patron_presion.get('unidad', 'psi')
        self.u_zero_val = 0.0

    def set_error_cero(self, lecturas_cero):
        """
        Calcula la incertidumbre por error de cero (u_zero).
        lecturas_cero: lista de lecturas realizadas en el punto nominal 0 (o min).
                       Ej: [lectura_ini_ciclo1, lectura_fin_ciclo1, ...]
        DKD-R 6-1: f0 = max(|diff|). u0 = f0 / sqrt(3).
        """
        if not lecturas_cero or len(lecturas_cero) < 2:
            self.u_zero_val = 0.0
            return

        # Asumimos que la lista son pares [Ini, Fin, Ini2, Fin2...] o secuencia temporal
        # La norma suele pedir la deriva máxima durante la calibración.
        # Compararemos la lectura FINAL de cada ciclo con su INICIAL (o el cero previo).
        # Simplificación robusta: Max(readings) - Min(readings) at zero?
        # Mejor: Diferencia máxima absoluta entre cualquier par de lecturas de cero.
        # O conservadoramente: range / sqrt(3)? 
        # DKD-R 6-1 Eq 4: f0 = x_2,0 - x_1,0 -> u = f0/sq3
        
        # Tomaremos la desviación máxima observada en el cero
        desviacion_max = max(lecturas_cero) - min(lecturas_cero)
        self.u_zero_val = desviacion_max / math.sqrt(3)

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
        rho_fluido = self.fluido.get('densidad', self.rho_aire)
        
        # Según DKD-R 6-1 Ec. (1) para presión manométrica: delta_p = (rho_fl - rho_air) * g * delta_h
        # Si es presión absoluta del sistema, típicamente no se resta rho_aire, pero asumiremos balanzas manométricas comunes
        rho_efectiva = rho_fluido - self.rho_aire
        
        delta_h_m = (self.env['altura_patron_mm'] - self.env['altura_inst_mm']) / 1000
        
        # Fórmula base da Pa (kg/m3 * m/s2 * m)
        presion_columna_pa = (delta_h_m * rho_efectiva * g)
        
        # Convertir Pa -> Unidad Instrumento
        return ConversorUnidades.normalizar(presion_columna_pa, 'pa', self.unidad_inst)

    def calcular_incertidumbre_altura(self):
        """ Retorna incertidumbre en la UNIDAD DEL INSTRUMENTO """
        g = self.env.get('gravedad', 9.77)
        rho_fluido = self.fluido.get('densidad', self.rho_aire)
        u_rho_fluido = self.fluido.get('u_densidad', self.u_rho_aire)
        
        rho_efectiva = abs(rho_fluido - self.rho_aire)
        u_rho_efectiva = math.sqrt(u_rho_fluido**2 + self.u_rho_aire**2)
        
        delta_h_m = abs(self.env['altura_patron_mm'] - self.env['altura_inst_mm']) / 1000
        if delta_h_m == 0: 
            delta_h_m = 0.001 # Prevenir división por cero en derivadas relativas si aplica
            rho_efectiva = 0.0  # Si la altura es exactamente 0, la contribución es netamente cero
            
        u_h_m = self.env.get('incertidumbre_regla_mm', 1.0) / 1000
        
        # Coeficientes de sensibilidad
        c_rho = g * delta_h_m
        uc_rho = c_rho * u_rho_efectiva
        c_h = rho_efectiva * g
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
            # Asegurar que la curva esté ordenada
            curva.sort(key=lambda x: x['indicacion'])
            
            # Interpolación
            encontrado = False
            for i in range(len(curva) - 1):
                p1 = curva[i]; p2 = curva[i+1]
                if p1['indicacion'] <= lectura_en_patron <= p2['indicacion']:
                    if (p2['indicacion'] - p1['indicacion']) == 0:
                        m = 0
                    else:
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

    def procesar_punto(self, presion_nominal, lecturas_asc, lecturas_desc):
        """
        Todo el cálculo se realiza en la unidad del instrumento (self.unidad_inst).
        Las lecturas simuladas ya vienen en esa unidad.
        """
        todas_lecturas = lecturas_asc + lecturas_desc
        if not todas_lecturas:
            return None # O manejar error

        promedio_lectura = statistics.mean(todas_lecturas)
        n = len(todas_lecturas)

        # Correcciones (ya convertidas a unidad inst)
        corr_patron = self.calcular_correccion_patron_curva(presion_nominal)
        corr_h = self.correccion_altura()
        
        # Modelo Matemático: P_ref = P_nom + C_pat + C_h
        # Nota: Aquí hay una sutileza. Si P_nom es lo que lee el instrumento bajo prueba,
        # entonces el Error = Ind_Inst - (P_patron_corregido + C_h).
        # En el código original: presion_ref = presion_nominal + corr_patron + corr_h.
        # Esto asume que 'presion_nominal' es la lectura del patrón??? NO, presion_nominal es el SET POINT.
        # Generalmente se calibra fijando la presión en el patrón o en el instrumento.
        # Asumiremos el modelo: Error = Lectura_IBC - Valor_Verdadero
        # Valor_Verdadero ~= Lectura_Patron + Corr_Patron + Corr_Altura
        
        # En este código original, parece que 'presion_nominal' se trata como la referencia base, y se le suman correcciones??
        # Revisando logica original:
        # presion_ref = presion_nominal + corr_patron + corr_h
        # error = promedio_lectura - presion_ref
        
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
        if lecturas_asc and lecturas_desc:
            prom_asc = statistics.mean(lecturas_asc)
            prom_desc = statistics.mean(lecturas_desc)
            u_histe = abs(prom_asc - prom_desc) / (2 * math.sqrt(3))
        else:
            u_histe = 0.0

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

        # ---------------------------------------------
        # 8. INCERTIDUMBRE POR ERROR DE CERO (u_zero)
        # ---------------------------------------------
        # Se calcula externamente y se almacena en self.u_zero_val
        # DKD-R 6-1: u_zero = max(|x0_fin - x0_ini|) / sqrt(3)
        u_zero = getattr(self, 'u_zero_val', 0.0)

        # ---------------------------------------------
        # SELECCIÓN DEL MÉTODO DE INCERTIDUMBRE
        # ---------------------------------------------
        metodo = self.params.get('metodo_incertidumbre', 'GUM (Convencional)')

        if metodo == 'Monte Carlo':
            # Simulación de Monte Carlo (M = 100,000)
            M = 100000
            
            # Repetibilidad (Normal)
            # asume distribucion t si n es pequeno, pero GUM Supp 1 aproxima normal con n>algo. Usamos Normal(0, u_rep)
            S_rep = np.random.normal(0, u_rep, M)
            
            # Resolución Inst (Uniforme)
            # Limites exactos: a = resolucion / 2
            a_res_inst = self.inst['resolucion'] / 2.0
            S_res_inst = np.random.uniform(-a_res_inst, a_res_inst, M)
            
            # Resolución Patrón (Uniforme)
            a_res_pat = res_pat_conv / 2.0
            S_res_pat = np.random.uniform(-a_res_pat, a_res_pat, M)
            
            # Histéresis (Uniforme)
            # a = |prom_asc - prom_desc| / 2
            a_histe = abs(prom_asc - prom_desc) / 2.0 if (lecturas_asc and lecturas_desc) else 0.0
            S_histe = np.random.uniform(-a_histe, a_histe, M) if a_histe > 0 else np.zeros(M)
            
            # Certificado Patrón (Normal)
            # Asumiendo factor k=2 proporcionado en el certificado
            S_patron_cert = np.random.normal(0, u_patron_cert, M)
            
            # Deriva Patrón (Uniforme)
            # Limites: a = valor_deriva
            a_deriva = deriva_conv
            S_deriva = np.random.uniform(-a_deriva, a_deriva, M)
            
            # Altura (Normal)
            # La distribución resultante de la combinación de m_h y rho suele tratarse como Normal
            S_altura = np.random.normal(0, u_altura, M)
            
            # Efecto Temperatura (Uniforme)
            # Limites exactos de temperatura asumidos rectangulares: a = compensacion_maxima
            a_temp = u_temp * math.sqrt(3) # u_temp ya viene de temp_efecto / sqrt(3)
            S_temp = np.random.uniform(-a_temp, a_temp, M)
            
            # Error de Cero (Uniforme)
            # a = max_drift_zero
            a_zero = getattr(self, 'max_error_zero_val', u_zero * math.sqrt(3))
            S_zero = np.random.uniform(-a_zero, a_zero, M)
            
            S_error = S_rep + S_res_inst + S_res_pat + S_histe + S_patron_cert + S_deriva + S_altura + S_temp + S_zero
            
            # Intervalo de Cobertura 95% (percentiles 2.5 y 97.5) exactos
            q_low = np.percentile(S_error, 2.5)
            q_high = np.percentile(S_error, 97.5)
            
            # Incertidumbre expandida (semiamplitud del rango simetrizado o longitud/2)
            U_expandida = (q_high - q_low) / 2.0
            u_combinada = np.std(S_error)

        else:
            # SUMA CUADRATICA (LEY DE PROPAGACION GUM CONVENCIONAL)
            suma_cuadrados = (u_rep**2 + u_res_inst**2 + u_res_pat**2 + 
                              u_histe**2 + u_patron_cert**2 + u_deriva**2 + 
                              u_altura**2 + u_temp**2 + u_zero**2)
            
            u_combinada = math.sqrt(suma_cuadrados)
            U_expandida = u_combinada * 2 

        return {
            'Punto Nominal': presion_nominal,
            'Lectura Promedio': promedio_lectura,
            'M1 (asc)': statistics.mean(lecturas_asc) if lecturas_asc else 0,
            'M2 (desc)': statistics.mean(lecturas_desc) if lecturas_desc else 0,
            'Ref. Corregida': presion_ref,
            'Error': error,
            'Histeresis': abs(statistics.mean(lecturas_asc) - statistics.mean(lecturas_desc)) if (lecturas_asc and lecturas_desc) else 0,
            'U Exp': U_expandida,
            'Unidad': self.unidad_inst,
            'u_rep': u_rep,
            'u_res_inst': u_res_inst,
            'u_patron': u_patron_cert,
            'u_histe': u_histe,
            'u_zero': u_zero
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

def determinar_secuencia_dkd(clase):
    """
    Determina la secuencia y parámetros según DKD-R 6-1.
    Retorna: (Secuencia [A/B/C], Precargas, Ciclos, MinPuntos)
    """
    if clase > 0.6:
        # Secuencia A (ej: clase 1.0, 1.6, 2.5, 4.0)
        return 'A', 1, 1, 6
    elif 0.1 <= clase <= 0.6:
        # Secuencia B (ej: clase 0.1, 0.25, 0.6)
        return 'B', 2, 2, 9
    else: 
        # Secuencia C (clase < 0.1, ej: 0.05, 0.025)
        return 'C', 2, 2, 9

def generar_puntos_calibracion(clase_exactitud, rango_max, rango_min=0.0, num_puntos_manual=None):
    """
    Genera puntos nominales.
    Si num_puntos_manual es definido, usa ese número distribuido uniformemente.
    Si no, usa lógica DKD-R 6-1.
    Soporte Manovacuómetros:
      - Si el rango cruza por cero (min < 0 < max), se deben generar:
        * 3 puntos de vacío (incluyendo 0).
        * El resto de puntos en el rango positivo.
    """
    span = rango_max - rango_min
    
    # Determinacion de puntos totales
    if num_puntos_manual:
        n = int(num_puntos_manual)
        if n < 5: n = 5 # Manovacuometro requiere minimos razonables si es custom
    else:
        secuencia, _, _, min_puntos = determinar_secuencia_dkd(clase_exactitud)
        n = min_puntos

    # DETECCIÓN MANOVACUÓMETRO (Cruz cruce por cero real y significativo)
    if rango_min < 0 and rango_max > 0:
        # Lógica solicitada: 3 puntos en vacío (incluyendo 0) + Resto en positivo
        # Puntos vacío: [rango_min, intermedio, 0]
        puntos_vacio = [rango_min, rango_min / 2.0, 0.0]
        
        # Puntos restantes para positivo
        n_pos = n - 3
        if n_pos < 2: n_pos = 2 # Al menos 2 positivos para tener algo de sentido (ej: 50%, 100%)
        
        # Generar positivos desde >0 hasta rango_max
        # No incluimos 0 de nuevo porque ya está en vacío
        puntos_pos = []
        for i in range(1, n_pos + 1):
            pct = i / n_pos
            puntos_pos.append(rango_max * pct)
            
        return sorted(list(set(puntos_vacio + puntos_pos)))
        
    else:
        # Lógica estándar (solo positivo o solo vacío pero continuo)
        if num_puntos_manual:
             # Generar n puntos de 0 a 100%
             porcentajes = [i * 100.0 / (n - 1) for i in range(n)]
        else:
             secuencia, _, _, min_puntos = determinar_secuencia_dkd(clase_exactitud)
             if min_puntos <= 6:
                 # Secuencia A (6 puntos): 0, 20, 40, 60, 80, 100
                 porcentajes = [0, 20, 40, 60, 80, 100]
             else:
                 # Secuencia B/C (9 puntos explícitos con cero)
                 porcentajes = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]
        
        return [rango_min + (p / 100.0) * span for p in porcentajes]

def obtener_patrones_disponibles(db):
    try:
        patrones = []
        for doc_id in db:
            # Filtrar registros basura de cabeceras importadas erróneamente
            if doc_id.lower() in ['código', 'codigo', 'code', 'id']:
                continue
                
            doc = db[doc_id]
            if doc.get('tipo') == 'manometro' or 'curva_calibracion' in doc:
                patrones.append(doc)
        return patrones
    except Exception as e:
        print(f"Error listando patrones: {e}")
        return []

def seleccionar_mejor_patron(rango_min_inst, rango_max_inst, unidad_inst, patrones_disponibles, progreso_callback=None):
    """
    Selecciona el mejor patrón basado en:
    1. Cobertura del rango (Patrón debe cubrir Rango Min y Max del Inst).
       Nota: Convertimos los rangos del instrumento a la unidad del patrón para comparar.
    2. Menor incertidumbre expandida en el punto máximo del instrumento.
    
    Retorna: (mejor_patron_doc, log_proceso)
    """
    candidatos = []
    log = []
    
    total = len(patrones_disponibles)
    for i, patron in enumerate(patrones_disponibles):
        if progreso_callback:
            progreso_callback(i / total, f"Evaluando {patron.get('alias', 'Patrón')}...")
            
        # 0. FILTRO TIPO DE PARAMETRO
        # Solo considerar manómetros explícitos (ignorando termohigrómetros y bombas)
        tipo = patron.get('tipo', 'manometro').lower()
        if tipo != 'manometro':
             continue

        # Doble chequeo por keywords (backup)
        param = patron.get('parametro', '').lower()
        unidad_patron = patron.get('unidad', '').lower()
        alias = patron.get('alias', '').lower()
        
        keywords_prohibidas = ['temp', 'humedad', '°', 'hz', '%', 'termo', 'higro', 'balanza']
        
        es_invalido = False
        for kw in keywords_prohibidas:
            if kw in param or kw in unidad_patron or kw in alias:
                es_invalido = True
                break
        
        if es_invalido:
            continue

        # 1. Chequeo de rango
        # Asumimos que el patrón tiene 'rango_min' y 'rango_max' o inferimos de su curva/datos
        # Si no tiene, usamos 0 a algo muy grande o fallamos.
        # Muchos patrones en la DB importada no tienen 'rango_max' explícito, pero sí curva.
        # Usaremos el máximo de la curva como rango máximo del patrón.
        
        curva = patron.get('curva_calibracion', [])
        if not curva:
            log.append(f"Descartado {patron.get('_id')}: Sin curva de calibración.")
            continue
            
        # Obtener rango patrón en SU unidad
        indicaciones_patron = [p['indicacion'] for p in curva]
        min_patron = min(indicaciones_patron)
        max_patron = max(indicaciones_patron)
        # Recuperar unidad original preservando mayúsculas para display
        unidad_patron_real = patron.get('unidad', 'psi')
        
        # Convertir rango instrumento a unidad patrón
        try:
            min_inst_conv = ConversorUnidades.normalizar(rango_min_inst, unidad_inst, unidad_patron_real)
            max_inst_conv = ConversorUnidades.normalizar(rango_max_inst, unidad_inst, unidad_patron_real)
        except Exception:
            log.append(f"Error conversión unidades {unidad_inst} -> {unidad_patron_real}")
            continue
        
        # Tolerancia pequeña para flotantes (e.g. 5% para ser flexible con rango nominal vs real)
        tol = 0.05 * max_patron 
        if min_inst_conv >= (min_patron - tol) and max_inst_conv <= (max_patron + tol):
            # 2. Calcular Incertidumbre Estimada en el punto máximo
            # Usamos la incertidumbre certificada del patrón + deriva (simplificado para selección)
            u_cert = patron.get('incertidumbre_expandida', 0) # En unidad patrón
            deriva = patron.get('deriva', 0) # En unidad patrón
            
            # Suma cuadrática simple para comparar "calidad" del patrón
            u_total_patron = math.sqrt((u_cert/2)**2 + (deriva/math.sqrt(3))**2) * 2
            
            # Convertir esa U a unidad del instrumento para comparar homogéneamente
            u_total_en_inst = ConversorUnidades.normalizar(u_total_patron, unidad_patron_real, unidad_inst)
            
            candidatos.append({
                'patron': patron,
                'u_estimada': u_total_en_inst,
                'max_patron': max_patron, # Solo info
                'unidad_patron': unidad_patron_real
            })
        else:
            log.append(f"Descartado {patron.get('alias')}: Rango [{min_patron:.2f}, {max_patron:.2f}] no cubre [{min_inst_conv:.2f}, {max_inst_conv:.2f}]")

    if not candidatos:
        return None, log
    
    # Ordenar por menor incertidumbre
    candidatos.sort(key=lambda x: x['u_estimada'])
    
    return candidatos[0]['patron'], log
