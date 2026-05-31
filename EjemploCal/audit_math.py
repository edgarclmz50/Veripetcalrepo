import sys
sys.path.append('.')
from calibration_core import CalibracionPresion
import math

datos_inst = {
    'rango_max': 100.0,
    'resolucion': 0.1,  
    'clase': 1.0,       
    'unidad': 'psi'
}

# Un patrón casi perfecto para no meter tanto ruido
equipos_db = {
    'presion': {
        'tipo': 'manometro',
        'unidad': 'psi',
        'resolucion': 0.01,
        'incertidumbre_expandida': 0.02, # u_cert = 0.01
        'deriva': 0.01, # rectangular = 0.01 / sqrt(3) = 0.0057
        'curva_calibracion': [{'indicacion': 0, 'correccion': 0.0}, {'indicacion': 100, 'correccion': 0.0}]
    },
    'termo': {}, 'baro': {}, 'fluido': {'nombre': 'Aire', 'densidad': 1.2, 'u_densidad': 0.01}
}

condiciones = {
    'temperatura': 20.0,
    'presion_atmosferica_hpa': 1013.25,
    'humedad_relativa': 50.0,
    'altura_patron_mm': 0.0, 
    'altura_inst_mm': 0.0,
    'incertidumbre_regla_mm': 1.0,
    'gravedad': 9.77
}

params = {'rm': 0.004, 'metodo_incertidumbre': 'GUM (Convencional)'}
calc = CalibracionPresion(datos_inst, equipos_db, condiciones, params)

# Set zero error manually: max diff = 0.05
calc.set_error_cero([0.00, 0.05])

# Lecturas: asc: 50.0, 50.1 / desc: 50.1, 50.2
res = calc.procesar_punto(50.0, [50.0, 50.1], [50.1, 50.2])

print("==== AUDITORIA DEL PRESUPUESTO GUM ====")
for k, v in res.items():
    if isinstance(v, float):
        print(f"{k}: {v:.6f}")
    else:
        print(f"{k}: {v}")
