import streamlit as st
import pandas as pd
import couchdb
import plotly.express as px
import plotly.graph_objects as go
from calibration_core import CalibracionPresion, generar_puntos_calibracion, obtener_patrones_disponibles, ConversorUnidades, seleccionar_mejor_patron, determinar_secuencia_dkd
from certificate_generator import create_certificate
import time
import datetime

# Configuración de la página
st.set_page_config(
    page_title="App Calibración Manómetros",
    page_icon="⚖️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Estilos CSS personalizados
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        color: #1E3A8A;
        text-align: center;
        margin-bottom: 2rem;
    }
    .metric-card {
        background-color: #F3F4F6;
        padding: 1rem;
        border-radius: 0.5rem;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
    .stDataFrame {
        width: 100%;
    }
    .sidebar-section {
        background-color: #f0f2f6;
        padding: 10px;
        border-radius: 5px;
        margin-bottom: 10px;
    }
</style>
""", unsafe_allow_html=True)

# --- CONEXIÓN DB ---
@st.cache_resource
def get_db_connection():
    try:
        couch = couchdb.Server('http://admin:password123@localhost:5984/')
        if 'patrones' not in couch:
            st.error("La base de datos 'patrones' no existe en CouchDB.")
            return None
        return couch['patrones']
    except Exception as e:
        st.error(f"Error conectando a CouchDB: {e}")
        return None

db = get_db_connection()

# --- ESTADO DE LA SESIÓN ---
if 'selected_patron_index' not in st.session_state:
    st.session_state.selected_patron_index = 0
if 'rango_min_input' not in st.session_state:
    st.session_state.rango_min_input = 0.0
if 'rango_max_input' not in st.session_state:
    st.session_state.rango_max_input = 100.0
if 'unidad_input' not in st.session_state:
    st.session_state.unidad_input = 'psi'
if 'editor_key' not in st.session_state:
    st.session_state.editor_key = 0
# --- HELPER PERSISTENCIA ROBUSTA ---
if 'persistent_data' not in st.session_state:
    st.session_state.persistent_data = {
        'marca': '', 'serie': '', 
        'rango_min': 0.0, 'rango_max': 100.0, 'unidad': 'psi',
        'resolucion': 0.01, 'clase': 1.0,
        'temp': 20.0, 'hr': 50.0, 'patm': 1013.25,
        'h_patron': 0.0, 'h_inst': 0.0, 'g': 9.77,
        'selected_patron_name': None,
        'selected_termo_name': None,
        'selected_bomba_name': None,
        'precargas_ok': False,
        'tiempo_estancamiento': 5.0, # Minutos según imagen/contexto usual
        'inspeccion_visual': ['Rosca', 'Dial/Pantalla', 'Carcasa', 'Mica', 'Puntero/Aguja'], # Default todos OK
        'estado_equipo': 'En Servicio',
        'prueba_hermeticidad_ok': False,
        'prueba_hermeticidad_ok': False,
        # New fields
        'estabilizacion_inicio': None, # Hora inicio
        'estabilizacion_fin': None,    # Hora fin
        'tipo_indicacion': 'Analógica', # Analógica / Digital
        'unidad': 'psi', # Default unit
        'norma_clase': 'ASME B40.100 (F.S.)', # Default standard
        'fluido': 'Aire',
        'lugar_calibracion': 'Laboratorio',
        'tipo_instrumento': 'Manómetro', # Manómetro, Vacuómetro, etc.
        'tamano': '',
        'ubicacion_instrumento': '',
        'selected_patron_aux_name': None, # Nuevo campo para patrón auxiliar
        'rango_cal_min': 0.0,
        'rango_cal_max': 100.0,
        'metodo_incertidumbre': 'GUM (Convencional)'
    }

def get_persist(key):
    return st.session_state.persistent_data.get(key)

def set_persist(key):
    # Callback to update storage from widget
    # Widget key must be f"ui_{key}"
    val = st.session_state[f"ui_{key}"]
    st.session_state.persistent_data[key] = val

# --- NAVEGACIÓN ---
st.sidebar.title("Navegación")

# BOTÓN NUEVA CALIBRACIÓN
if st.sidebar.button("✨ Nueva Calibración", type="primary", use_container_width=True):
    # Limpiar estado
    if 'persistent_data' in st.session_state:
        # Resetear a valores por defecto
        st.session_state.persistent_data = {
            'marca': '', 'serie': '', 
            'rango_min': 0.0, 'rango_max': 100.0, 'unidad': 'psi',
            'resolucion': 0.01, 'clase': 1.0,
            'temp': 20.0, 'hr': 50.0, 'patm': 1013.25,
            'h_patron': 0.0, 'h_inst': 0.0, 'g': 9.77,
            'selected_patron_name': None,
            'selected_termo_name': None,
            'selected_bomba_name': None,
            'precargas_ok': False,
            'tiempo_estancamiento': 5.0,
            'inspeccion_visual': ['Rosca', 'Dial/Pantalla', 'Carcasa', 'Mica', 'Puntero/Aguja'],
            'estado_equipo': 'En Servicio',
            'prueba_hermeticidad_ok': False,
            'prueba_hermeticidad_ok': False,
            'estabilizacion_inicio': None,
            'estabilizacion_fin': None,
            'tipo_indicacion': 'Analógica',
            'unidad': 'psi',
            'norma_clase': 'ASME B40.100 (F.S.)',
            'fluido': 'Aire',
            'lugar_calibracion': 'Laboratorio',
            'tipo_instrumento': 'Manómetro',
            'tamano': '',
            'ubicacion_instrumento': '',
            'selected_patron_aux_name': None, # Nuevo campo para patrón auxiliar
            'rango_cal_min': 0.0,
            'rango_cal_max': 100.0,
            'metodo_incertidumbre': 'GUM (Convencional)'
        }
    
    # También limpiar DF y editor
    keys_to_reset = ['puntos_df', 'editor_data', 'selected_patron_index']
    for k in keys_to_reset:
        if k in st.session_state:
            del st.session_state[k]
            
    # Forzar recarga de widgets con nueva key
    st.session_state.editor_key += 1
    st.rerun()

app_mode = st.sidebar.radio("Ir a:", ["🛠️ Calibración", "📋 Inventario de Patrones", "📂 Historial Calibraciones"])

# --- VISTA 1: CALIBRACIÓN (Lógica Original) ---
if app_mode == "🛠️ Calibración":

    # --- SIDEBAR: CONFIGURACIÓN (Solo visible en Calibración) ---
    selected_patron = None # Inicializar para evitar NameError
    st.sidebar.markdown("---")
    st.sidebar.title("Configuración")

    # 1. SELECCIÓN DE EQUIPOS
    st.sidebar.subheader("Equipos y Patrones")
    
    if db:
        all_patrones = obtener_patrones_disponibles(db)
        
        # Filtrar por tipos
        manometros = [p for p in all_patrones if p.get('tipo', 'manometro') == 'manometro']
        bombas = [p for p in all_patrones if p.get('tipo', 'fuente_presion') == 'fuente_presion']
        termos = [p for p in all_patrones if p.get('tipo') == 'termohigrometro']

        # A. FUENTE DE PRESIÓN
        st.sidebar.markdown("**1. Fuente de Presión**")
        bombas_dict = {f"{p.get('_id')} | {p.get('alias')}" : p for p in bombas}
        bombas_names = ["Ninguna"] + list(bombas_dict.keys())
        
        curr_bomba = get_persist('selected_bomba_name')
        idx_bomba = bombas_names.index(curr_bomba) if curr_bomba in bombas_names else 0
        
        st.sidebar.selectbox(
            "Bomba / Generador",
            options=bombas_names,
            index=idx_bomba,
            key="ui_selected_bomba_name",
            on_change=set_persist, args=('selected_bomba_name',)
        )

        if curr_bomba != "Ninguna":
             b_obj = next((p for p in bombas if f"{p.get('_id')} | {p.get('alias')}" == curr_bomba), None)
             if b_obj:
                 st.sidebar.info(f"**ID:** {b_obj.get('_id')}  \n**Rango:** {b_obj.get('rango_max')} {b_obj.get('unidad')}")

        st.sidebar.divider()

        # B. TERMOHIGRÓMETRO
        st.sidebar.markdown("**2. Termohigrómetro**")
        termos_dict = {f"{p.get('_id')} | {p.get('alias')}" : p for p in termos}
        termos_names = ["Ninguno"] + list(termos_dict.keys())
        
        curr_termo = get_persist('selected_termo_name')
        idx_termo = termos_names.index(curr_termo) if curr_termo in termos_names else 0
        
        st.sidebar.selectbox(
            "Monitor Ambiental",
            options=termos_names,
            index=idx_termo,
            key="ui_selected_termo_name",
            on_change=set_persist, args=('selected_termo_name',)
        )

        if curr_termo != "Ninguno":
             t_obj = next((p for p in termos if f"{p.get('_id')} | {p.get('alias')}" == curr_termo), None)
             if t_obj:
                 st.sidebar.info(f"**ID:** {t_obj.get('_id')}  \n**Incertidumbre:** {t_obj.get('incertidumbre_temp','-')} °C / {t_obj.get('incertidumbre_hr','-')} %HR")
        
        st.sidebar.markdown("---")
        
        # 2. CONDICIONES AMBIENTALES
        st.sidebar.subheader("Condiciones Ambientales")
        
        temp = st.sidebar.number_input("Temperatura (°C)", step=0.1, 
                                     value=get_persist('temp'), 
                                     key="ui_temp", on_change=set_persist, args=('temp',))
        
        hr = st.sidebar.number_input("Humedad Relativa (%)", step=1.0, 
                                   value=get_persist('hr'), 
                                   key="ui_hr", on_change=set_persist, args=('hr',))
        
        p_atm = st.sidebar.number_input("Presión Atm. (hPa)", step=1.0, 
                                      value=get_persist('patm'), 
                                      key="ui_patm", on_change=set_persist, args=('patm',))
        
        with st.sidebar.expander("Ajustes de Altura y Gravedad"):
            h_patron = st.sidebar.number_input("Altura Patrón (mm)", 
                                             value=get_persist('h_patron'), 
                                             key="ui_h_patron", on_change=set_persist, args=('h_patron',))
            h_inst = st.sidebar.number_input("Altura Instrumento (mm)", 
                                           value=get_persist('h_inst'), 
                                           key="ui_h_inst", on_change=set_persist, args=('h_inst',))
            g_local = st.sidebar.number_input("Gravedad Local (m/s²)", format="%.4f", 
                                            value=get_persist('g'), 
                                            key="ui_g", on_change=set_persist, args=('g',))



    # --- MAIN CALIBRATION AREA ---
    st.markdown('<div class="main-header">Calibración de Manómetros</div>', unsafe_allow_html=True)

    if not db:
        st.warning("No hay conexión a la base de datos.")
        st.stop()

    # 1. DATOS DEL INSTRUMENTO
    with st.container():
        st.subheader("1. Datos del Instrumento Bajo Prueba (IBC)")
        
        # --- A. IDENTIFICACIÓN ---
        st.markdown("###### 🆔 Identificación")
        # Added extra column for Instrument Type
        c_id1, c_id2, c_id3, c_id4, c_id5 = st.columns(5)
        
        with c_id1:
            # Lista basada en la imagen del usuario
            opts_instr = ["MANÓMETRO", "MANOVACUÓMETRO", "VACUÓMETRO", "REGISTRADOR DE PRESIÓN CARTOGRÁFICO"]
            tipo_instr_val = get_persist('tipo_instrumento')
            # Handle case sensitivity or defaults if needed
            if tipo_instr_val and tipo_instr_val.upper() in opts_instr:
                idx_instr = opts_instr.index(tipo_instr_val.upper())
            else:
                idx_instr = 0
            
            tipo_instrumento = st.selectbox("Instrumento", opts_instr, index=idx_instr, key="ui_tipo_instrumento", on_change=set_persist, args=('tipo_instrumento',))

        with c_id2:
            marca = st.text_input("Marca/Modelo", value=get_persist('marca'), key="ui_marca", on_change=set_persist, args=('marca',))
        with c_id3:
            serie = st.text_input("N° Serie/Código", value=get_persist('serie'), key="ui_serie", on_change=set_persist, args=('serie',))
        with c_id4:
             ubicacion = st.text_input("Ubicación", value=get_persist('ubicacion_instrumento'), placeholder="e.g. Sala Máquinas", key="ui_ubicacion_instrumento", on_change=set_persist, args=('ubicacion_instrumento',))
        with c_id5:
             tamano = st.text_input("Tamaño/Diámetro", value=get_persist('tamano'), placeholder="e.g. 4 in", key="ui_tamano", on_change=set_persist, args=('tamano',))


        # --- CALLBACKS ESPECIALES (Definidos antes de su uso) ---
        def recalc_clase():
            # Solo para analógicos
            tipo = st.session_state.persistent_data.get('tipo_indicacion', 'Analógica')
            norma = st.session_state.persistent_data.get('norma_clase', 'ASME B40.100 (F.S.)')
            
            if tipo == 'Analógica':
                div = st.session_state.persistent_data.get('resolucion', 0.1)
                base_calculo = 0.0

                if "ASME" in norma:
                    # ASME B40.100 usa Rango de Instrumento (Full Scale)
                    r_min = st.session_state.persistent_data.get('rango_min', 0.0)
                    r_max = st.session_state.persistent_data.get('rango_max', 100.0)
                    # Interpretación FS: Máximo valor absoluto
                    base_calculo = max(abs(r_min), abs(r_max))
                    if base_calculo == 0: base_calculo = abs(r_max - r_min)
                else:
                    # EN 837-1 usa Rango de Calibración (Span)
                    # "Si indico EN 837-1 (Span), debe agarrar entonces de el rango de calibracion"
                    r_cal_min = st.session_state.persistent_data.get('rango_cal_min', 0.0)
                    r_cal_max = st.session_state.persistent_data.get('rango_cal_max', 100.0)
                    base_calculo = abs(r_cal_max - r_cal_min)
                
                if base_calculo > 0:
                    clase_calc = (div / base_calculo) * 100.0
                    st.session_state.persistent_data['clase'] = clase_calc
                    st.session_state.persistent_data['ui_clase'] = clase_calc
                    st.session_state['ui_clase'] = clase_calc # Force update
                    st.toast(f"Clase recalculada ({norma}): {clase_calc:.2f}% (Base: {base_calculo})")

        def set_persist_and_recalc(key):
            set_persist(key)
            recalc_clase()

        # --- B. DETALLES METROLÓGICOS ---
        st.markdown("###### 📏 Metrología y Configuración")
        # Usamos 5 columnas para alinear mejor los inputs
        c_met1, c_met2, c_met3, c_met4, c_met5 = st.columns(5)
        
        with c_met1:
             # Tipo Indicación
             tipo_ind = st.selectbox("Tipo", ["Analógica", "Digital"], 
                                   index=["Analógica", "Digital"].index(get_persist('tipo_indicacion')),
                                   key="ui_tipo_indicacion", on_change=set_persist, args=('tipo_indicacion',))
        
        with c_met2:
             # Unidad
             opts_unidad = ["psi", "bar", "kPa", "MPa", "kgf/cm2", "mmHg", "inHg"]
             curr_u = get_persist('unidad')
             idx_u = opts_unidad.index(curr_u) if curr_u in opts_unidad else 0
             unidad = st.selectbox("Unidad", opts_unidad, index=idx_u, key="ui_unidad", on_change=set_persist, args=('unidad',))


        with c_met3:
             # Resolución
             lbl_res = "División Mínima" if tipo_ind == 'Analógica' else "Resolución"
             # Usar el callback de recálculo si es analógico (el chequeo está dentro de la fn)
             cb = set_persist_and_recalc if tipo_ind == 'Analógica' else set_persist
             resolucion = st.number_input(lbl_res, format="%.4f", value=get_persist('resolucion'), key="ui_resolucion", on_change=cb, args=('resolucion',))
        
        with c_met4:
             # Clase
             clase = st.number_input("Clase (% F.S.)", step=0.1, format="%.2f", value=get_persist('clase'), key="ui_clase", on_change=set_persist, args=('clase',))
        
        with c_met5:
             # Fluido
             fluido = st.selectbox("Fluido", ["Aire", "Aceite", "Nitrógeno", "Agua"], 
                                index=["Aire", "Aceite", "Nitrógeno", "Agua"].index(get_persist('fluido')),
                                key="ui_fluido", on_change=set_persist, args=('fluido',))
             
        # --- C. RANGOS (Simétricos: Instrumento Arriba, Calibración Abajo) ---
        
        # --- D. PATRONES DE REFERENCIA (MOVIDO AQUÍ) ---
        st.markdown("###### ⚙️ Selección de Patrones")
        c_pat1, c_pat2 = st.columns(2)

        # Recuperar lista de patrones (ya cargada en sidebar scope si db ok, sino empty)
        # Necesitamos manometros aqui. Ojo scope.
        # Recargamos para estar seguros o lo pasamos a session state?
        # Mejor re-filtrar de all_patrones si esta definido, sino vacio
        local_manometros = []
        if db:
             # Podriamos cachear esto, pero por ahora re-obtenemos rapido
             top_patrones = obtener_patrones_disponibles(db)
             local_manometros = [p for p in top_patrones if p.get('tipo', 'manometro') == 'manometro']
        
        pat_names = [f"{p.get('_id')} | {p.get('alias')}" for p in local_manometros]
        
        with c_pat1:
            curr_pat = get_persist('selected_patron_name')
            idx_pat = pat_names.index(curr_pat) if curr_pat in pat_names else 0
            selected_patron_name = st.selectbox("Patrón Principal (Presión)", pat_names, index=idx_pat, key="ui_selected_patron_name", on_change=set_persist, args=('selected_patron_name',))
            
            # Asignar objeto seleccionado
            if selected_patron_name:
                 selected_patron = next((p for p in local_manometros if f"{p.get('_id')} | {p.get('alias')}" == selected_patron_name), None)

        # Lógica para mostrar patrón secundario
        tipo_instr = get_persist('tipo_instrumento')
        es_manovacuometro = "VACUÓMETRO" in str(tipo_instr).upper() if tipo_instr else False
        
        # Checkbox fuera de columnas para alineación
        usar_secundario = st.checkbox("Habilitar 2do Patrón (Vacío / Aux)", value=(es_manovacuometro or get_persist('selected_patron_aux_name') is not None))

        with c_pat2:
            selected_patron_aux = None # Inicializar por defecto
            if usar_secundario:
                 curr_aux = get_persist('selected_patron_aux_name')
                 idx_aux = pat_names.index(curr_aux) if curr_aux in pat_names else 0
                 # Opción 'Ninguno' para limpiar
                 opts_aux = ["Ninguno"] + pat_names
                 idx_aux_ui = opts_aux.index(curr_aux) if curr_aux in opts_aux else 0
                 
                 selected_patron_aux_name = st.selectbox("Patrón Secundario", opts_aux, index=idx_aux_ui, key="ui_selected_patron_aux_name", 
                                                       on_change=lambda: st.session_state.persistent_data.update({'selected_patron_aux_name': st.session_state.ui_selected_patron_aux_name if st.session_state.ui_selected_patron_aux_name != "Ninguno" else None}))
                 
                 # Buscar objeto aux
                 if selected_patron_aux_name and selected_patron_aux_name != "Ninguno":
                      selected_patron_aux = next((p for p in local_manometros if f"{p.get('_id')} | {p.get('alias')}" == selected_patron_aux_name), None)
            else:
                 st.session_state.persistent_data['selected_patron_aux_name'] = None
                 selected_patron_aux = None

        st.markdown("###### 🎯 Definición de Rangos")
        
        # Selector de Norma (Antes de los inputs de rango)
        # c_norm1, c_norm2 = st.columns([1, 1])
        # with c_norm1:
        st.radio("Norma para Cálculo de Clase", ["ASME B40.100 (F.S.)", "EN 837-1 (Span)"],
                   index=["ASME B40.100 (F.S.)", "EN 837-1 (Span)"].index(get_persist('norma_clase') or "ASME B40.100 (F.S.)"),
                   horizontal=True,
                   key="ui_norma_clase", on_change=set_persist_and_recalc, args=('norma_clase',))

        # Contenedor con borde o fondo para distinguir la sección
        with st.container():
            # FILA 1: INSTRUMENTO
            st.caption("Rango Nominal del Instrumento (IBC)")
            c_inst1, c_inst2, c_inst3 = st.columns([1, 1, 0.5])
            with c_inst1:
                 rango_min = st.number_input("Mínimo (Inst)", step=1.0, value=get_persist('rango_min'), key="ui_rango_min", on_change=set_persist_and_recalc, args=('rango_min',))
            with c_inst2:
                 rango_max = st.number_input("Máximo (Inst)", step=10.0, value=get_persist('rango_max'), key="ui_rango_max", on_change=set_persist_and_recalc, args=('rango_max',))
            with c_inst3:
                 st.write("") # Espacio vacío para alineación

            # FILA 2: CALIBRACIÓN
            st.caption("Rango Real de Calibración")
            c_cal1, c_cal2, c_cal3 = st.columns([1, 1, 0.5])
            with c_cal1:
                 r_cal_min = st.number_input("Mínimo (Cal)", value=get_persist('rango_cal_min'), key="ui_rango_cal_min", on_change=set_persist, args=('rango_cal_min',))
            with c_cal2:
                 r_cal_max = st.number_input("Máximo (Cal)", value=get_persist('rango_cal_max'), key="ui_rango_cal_max", on_change=set_persist, args=('rango_cal_max',))
            with c_cal3:
                 st.write("") 
                 st.write("") # Spacer vertical para alinear con inputs
                 # Boton para igualar
                 def igualar_callback():
                     st.session_state.persistent_data['rango_cal_min'] = st.session_state.persistent_data['rango_min']
                     st.session_state.persistent_data['rango_cal_max'] = st.session_state.persistent_data['rango_max']
                     # Force widget update by setting the key directly
                     # This is safe here because the callback runs before the widget is rendered in the rerurn
                     st.session_state['ui_rango_cal_min'] = st.session_state.persistent_data['rango_min']
                     st.session_state['ui_rango_cal_max'] = st.session_state.persistent_data['rango_max']
                     # Recalcular clase si estamos en modo EN 837-1 o si el cambio afecta
                     recalc_clase()

                 st.button("⬇️ Igualar", help="Copiar rango instrumento a calibración", use_container_width=True, on_click=igualar_callback)

        st.divider()
        # Segunda fila de Configuración menos crítica
        c_conf1, c_conf2 = st.columns(2)
        with c_conf1:
             lugar = st.radio("Lugar de Calibración", ["Laboratorio", "In Situ"], 
                            index=["Laboratorio", "In Situ"].index(get_persist('lugar_calibracion')),
                            horizontal=True,
                            key="ui_lugar_calibracion", on_change=set_persist, args=('lugar_calibracion',))
        with c_conf2:
             # Selector método de incertidumbre
             metodo_incertidumbre = st.selectbox("Método de Incertidumbre", ["GUM (Convencional)", "Monte Carlo"],
                            index=["GUM (Convencional)", "Monte Carlo"].index(get_persist('metodo_incertidumbre')),
                            key="ui_metodo_incertidumbre", on_change=set_persist, args=('metodo_incertidumbre',))



    # 2. GENERACIÓN DE PUNTOS
    st.subheader("2. Puntos de Calibración")

    # Determinar Secuencia DKD
    secuencia, precargas, ciclos, min_pts = determinar_secuencia_dkd(clase)
    
    col_seq1, col_seq2 = st.columns([3, 1])
    with col_seq1:
         st.info(f"**Secuencia DKD-R 6-1:** {secuencia} (Mín {min_pts} ptos) | **Precargas:** {precargas} al máx.")
    with col_seq2:
         # Selector de Puntos Manual (Opcional)
         usar_custom = st.checkbox("Personalizar Puntos", value=False, key="chk_custom_pts")
         if usar_custom:
             n_puntos = st.number_input("Cant.", min_value=2, max_value=20, value=min_pts, step=1, label_visibility="collapsed")
         else:
             n_puntos = None

    if 'puntos_df' not in st.session_state:
        st.session_state.puntos_df = pd.DataFrame(columns=['Punto Nominal', 'Lectura Asc 1', 'Lectura Desc 1', 'Lectura Asc 2', 'Lectura Desc 2'])

    # --- 2. PREPARACIÓN PREVIA (EXPANDIBLE) ---
    with st.expander("2. Preparación Previa e Inspección", expanded=True):
        
        # A. Inspección Visual
        st.markdown("**A. Inspección Visual**")
        c_vis1, c_vis2 = st.columns(2)
        with c_vis1:
            st.selectbox("Estado del Equipo", ["En Servicio", "Nuevo", "Reparado"], 
                        index=["En Servicio", "Nuevo", "Reparado"].index(get_persist('estado_equipo')),
                        key="ui_estado_equipo", on_change=set_persist, args=('estado_equipo',))
            
        with c_vis2:
            # Multiselect para items conformes
            items_posibles = ['Rosca', 'Dial/Pantalla', 'Carcasa', 'Mica', 'Puntero/Aguja']
            st.multiselect("Componentes en Buen Estado", items_posibles,
                          default=get_persist('inspeccion_visual'),
                          key="ui_inspeccion_visual", on_change=set_persist, args=('inspeccion_visual',))

        st.divider()

        # B. Prueba de Hermeticidad y Precargas
        st.markdown("**B. Pruebas Preliminares**")
        c_test1, c_test2, c_test3 = st.columns(3)
        with c_test1:
             st.checkbox("✅ Precargas Realizadas (3)", 
                          value=get_persist('precargas_ok'),
                          key="ui_precargas_ok", on_change=set_persist, args=('precargas_ok',))
        with c_test2:
             st.checkbox("✅ Prueba Hermeticidad OK",
                          value=get_persist('prueba_hermeticidad_ok'),
                          key="ui_prueba_hermeticidad_ok", on_change=set_persist, args=('prueba_hermeticidad_ok',))
        with c_test3:
             t_estancamiento = st.number_input("⏱️ T. Estancamiento (min)", min_value=0.0, step=0.5,
                              value=get_persist('tiempo_estancamiento'),
                              key="ui_tiempo_estancamiento", on_change=set_persist, args=('tiempo_estancamiento',))
             
             if st.button("▶️ Iniciar", help="Iniciar cuenta regresiva", key="btn_timer_leak"):
                  if t_estancamiento > 0:
                      progress_bar = st.progress(0)
                      status_text = st.empty()
                      total_seconds = int(t_estancamiento * 60)
                      
                      for i in range(total_seconds + 1):
                          # Calcular porcentaje y tiempo restante
                          progress = i / total_seconds
                          remaining = total_seconds - i
                          mins, secs = divmod(remaining, 60)
                          
                          progress_bar.progress(progress)
                          status_text.markdown(f"⏳ **Tiempo Restante:** {mins:02d}:{secs:02d}")
                          time.sleep(1) # Bloqueante pero efectivo para este caso simple
                      
                      status_text.success("✅ ¡Tiempo Completado!")
                      st.session_state.persistent_data['prueba_hermeticidad_ok'] = True
                      st.balloons()
                      time.sleep(1)
                      st.rerun()
                  else:
                      st.warning("Ingrese un tiempo mayor a 0.")
    
        st.divider()

        # C. Estabilización Ambiental
        st.markdown("**C. Estabilización Ambiental**")
        c_estab1, c_estab2 = st.columns(2)

        # Convertir string persistido a time obj si es necesario, o usar value default
        def parse_time(val):
            import datetime
            if isinstance(val, str):
                try:
                    return datetime.time.fromisoformat(val)
                except:
                    return datetime.datetime.now().time()
            elif isinstance(val, datetime.time):
                return val
            return datetime.datetime.now().time()

        with c_estab1:
            t_ini_val = get_persist('estabilizacion_inicio')
            val_ini = parse_time(t_ini_val) if t_ini_val else None
            
            # Wrapper para guardar como string ISO
            def set_time_ini():
                    st.session_state.persistent_data['estabilizacion_inicio'] = st.session_state.ui_estabilizacion_inicio.strftime("%H:%M:%S")

            st.time_input("Hora Inicio", value=val_ini, key="ui_estabilizacion_inicio", on_change=set_time_ini)

        with c_estab2:
            t_fin_val = get_persist('estabilizacion_fin')
            val_fin = parse_time(t_fin_val) if t_fin_val else None

            def set_time_fin():
                    st.session_state.persistent_data['estabilizacion_fin'] = st.session_state.ui_estabilizacion_fin.strftime("%H:%M:%S")

            st.time_input("Hora Fin", value=val_fin, key="ui_estabilizacion_fin", on_change=set_time_fin)
    
    st.divider()
    
    # 3. GENERACIÓN DE PUNTOS
    st.subheader("3. Puntos de Calibración")

    if 'puntos_df' not in st.session_state:
        st.session_state.puntos_df = pd.DataFrame(columns=['Punto Nominal', 'Lectura Asc 1', 'Lectura Desc 1', 'Lectura Asc 2', 'Lectura Desc 2'])

    col_gen1, col_gen2 = st.columns([1, 3])
    with col_gen1:
        if st.button("Generar Puntos Automáticos"):
            # Usar rango de calibración si existe y difiere, o el del instrumento
            r_min_gen = get_persist('rango_cal_min')
            r_max_gen = get_persist('rango_cal_max')
            if r_max_gen == 0 and r_min_gen == 0: # Default o no seteado
                r_min_gen = rango_min
                r_max_gen = rango_max

            puntos_nominales = generar_puntos_calibracion(clase, r_max_gen, r_min_gen, num_puntos_manual=n_puntos)
            
            data = []
            for p in puntos_nominales:
                row = {'Punto Nominal': p, 'Lectura Asc 1': 0.0, 'Lectura Desc 1': 0.0}
                if ciclos > 1:
                    row.update({'Lectura Asc 2': 0.0, 'Lectura Desc 2': 0.0})
                data.append(row)
            
            # Forzar limpieza de cualquier estado anterior del editor
            # Forzar limpieza de cualquier estado anterior del editor
            # Incrementamos la key para resetear el widget data_editor
            st.session_state.editor_key += 1
            
            st.session_state.puntos_df = pd.DataFrame(data)
            st.rerun() # Recargar para que el editor se actualice con los nuevos valores vacios

    with col_gen2:
        if selected_patron:
            # Calcular rango del patrón para mostrar
            curva = selected_patron.get('curva_calibracion', [])
            rango_txt = "N/A"
            if curva:
                vals = [p['indicacion'] for p in curva]
                rango_txt = f"{min(vals)} a {max(vals)} {selected_patron.get('unidad')}"
            
            clase_patron = selected_patron.get('clase_exactitud', 'N/A')
            
            msg = f"**Patrón Principal:** {selected_patron.get('alias', 'Ninguno')} (ID: {selected_patron.get('_id', '-')})  \n" \
                  f"**Clase:** {clase_patron} | **Rango:** {rango_txt}"

            if selected_patron_aux:
                 curva2 = selected_patron_aux.get('curva_calibracion', [])
                 rango_txt2 = "N/A"
                 if curva2:
                      vals2 = [p['indicacion'] for p in curva2]
                      rango_txt2 = f"{min(vals2)} a {max(vals2)} {selected_patron_aux.get('unidad')}"
                 
                 msg += f"\n\n**Patrón Secundario:** {selected_patron_aux.get('alias', 'Ninguno')} (ID: {selected_patron_aux.get('_id', '-')})  \n" \
                        f"**Clase:** {selected_patron_aux.get('clase_exactitud', 'N/A')} | **Rango:** {rango_txt2}"

            st.info(msg)
        else:
            st.warning("Seleccione un patrón para continuar.")

    # 3. INGRESO DE LECTURAS
    # Configuración de columnas dinámica según ciclos
    col_config = {
        "Punto Nominal": st.column_config.NumberColumn("Nominal", format="%.4f"),
        "Lectura Asc 1": st.column_config.NumberColumn("Ascenso 1", format="%.4f"),
        "Lectura Desc 1": st.column_config.NumberColumn("Descenso 1", format="%.4f"),
    }
    
    # Si tenemos 2 ciclos, agregamos las columnas correspondientes
    if ciclos > 1:
        col_config["Lectura Asc 2"] = st.column_config.NumberColumn("Ascenso 2", format="%.4f")
        col_config["Lectura Desc 2"] = st.column_config.NumberColumn("Descenso 2", format="%.4f")
    
    # Filtrar columnas del DF para mostrar solo las necesarias
    cols_to_show = ['Punto Nominal', 'Lectura Asc 1', 'Lectura Desc 1']
    if ciclos > 1:
        cols_to_show.extend(['Lectura Asc 2', 'Lectura Desc 2'])
        
    # Asegurar que el DF tenga las columnas necesarias (si se cambio de clase sin regenerar)
    for col in cols_to_show:
        if col not in st.session_state.puntos_df.columns:
            st.session_state.puntos_df[col] = 0.0

    # Envolver en formulario para evitar recargas constantes
    with st.form("entry_form"):
        edited_df = st.data_editor(
            st.session_state.puntos_df[cols_to_show],
            num_rows="dynamic",
            use_container_width=True,
            column_config=col_config,
            key=f"editor_data_{st.session_state.editor_key}" 
        )
        
        submitted = st.form_submit_button("Calcular Resultados", type="primary")

    if submitted:
        # Persistir cambios manuales en el DF principal
        # Actualizar SIEMPRE el dataframe de sesión con los datos del editor
        for col in cols_to_show:
            st.session_state.puntos_df[col] = edited_df[col]
        
        # 4. CÁLCULO Y RESULTADOS

        if edited_df.empty:
            st.error("No hay datos para calcular.")
        elif not selected_patron:
            st.error("Debe seleccionar un patrón válido.")
        else:
            # Preparar objetos para el núcleo de cálculo
            datos_inst = {
                'rango_max': rango_max,
                'resolucion': resolucion,
                'clase': clase,
                'unidad': unidad
            }
            
            nombre_fluido = st.session_state.persistent_data.get('fluido', 'Aire')
            if nombre_fluido == 'Aceite':
                fl_dict = {'nombre': 'Aceite', 'densidad': 850.0, 'u_densidad': 10.0}
            elif nombre_fluido == 'Agua':
                fl_dict = {'nombre': 'Agua', 'densidad': 998.0, 'u_densidad': 2.0}
            elif nombre_fluido == 'Nitrógeno':
                fl_dict = {'nombre': 'Nitrógeno', 'densidad': 1.15, 'u_densidad': 0.05}
            else:
                fl_dict = {'nombre': 'Aire', 'densidad': 1.2, 'u_densidad': 0.01}
                
            equipos_db = {
                'presion': selected_patron,
                'termo': {},
                'baro': {},
                'fluido': fl_dict
            }
            # Intentar poblar mocks solo para termo y baro
            if db:
                equipos_db['termo'] = db.get('termo_001', {})
                equipos_db['baro'] = db.get('baro_001', {})
            
            condiciones = {
                'temperatura': temp,
                'presion_atmosferica_hpa': p_atm,
                'humedad_relativa': hr,
                'altura_patron_mm': h_patron,
                'altura_inst_mm': h_inst,
                'incertidumbre_regla_mm': 1.0,
                'gravedad': g_local
            }
            
            params = {
                'rm': 0.004,
                'metodo_incertidumbre': get_persist('metodo_incertidumbre')
            }
            
            calculator = CalibracionPresion(datos_inst, equipos_db, condiciones, params)
            
            # 4.1 CÁLCULO DE ERROR DE CERO (u_zero)
            # Buscar filas donde Nominal == Rango Minimo (0 generalmente)
            try:
                # Filtrar con pequeña tolerancia por si float
                df_cero = edited_df[abs(edited_df['Punto Nominal'] - rango_min) < 1e-5]
                lecturas_cero = []
                for _, row_0 in df_cero.iterrows():
                    # Recolectar todas las lecturas de esta fila (Asc/Desc)
                    lecturas_cero.append(float(row_0.get('Lectura Asc 1', 0)))
                    lecturas_cero.append(float(row_0.get('Lectura Desc 1', 0)))
                    if ciclos > 1:
                        lecturas_cero.append(float(row_0.get('Lectura Asc 2', 0)))
                        lecturas_cero.append(float(row_0.get('Lectura Desc 2', 0)))
                
                # Pasar al calculador
                calculator.set_error_cero(lecturas_cero)
            except Exception as e:
                # st.warning(f"No se pudo calcular error de cero: {e}")
                pass
            
            for index, row in edited_df.iterrows():
                try:
                    nom = float(row['Punto Nominal'])

                    # --- CAMBIO DE PATRÓN DINÁMICO ---
                    # Si el punto es negativo y existe patrón auxiliar (vacuómetro), usarlo
                    if selected_patron_aux and nom < 0:
                        calculator.set_patron_presion(selected_patron_aux)
                    else:
                        calculator.set_patron_presion(selected_patron)

                    asc = [float(row.get('Lectura Asc 1', 0))]
                    if 'Lectura Asc 2' in row and row['Lectura Asc 2'] not in (None, ''):
                        asc.append(float(row['Lectura Asc 2']))
                        
                    desc = [float(row.get('Lectura Desc 1', 0))]
                    if 'Lectura Desc 2' in row and row['Lectura Desc 2'] not in (None, ''):
                        desc.append(float(row['Lectura Desc 2']))
                    
                    res_punto = calculator.procesar_punto(nom, asc, desc)
                    if res_punto:
                        calculator.resultados.append(res_punto)
                except ValueError:
                    st.warning(f"Fila {index+1}: Datos numéricos inválidos.")

            # Evaluar conformidad
            resultados_evaluados = calculator.evaluar_conformidad(rango_max, clase)
            res_df = pd.DataFrame(resultados_evaluados)
            
            # --- PERSISTENCIA DE RESULTADOS ---
            st.session_state['cal_result_df'] = res_df
            st.session_state['cal_vars'] = {
                'rho_aire': calculator.rho_aire
            }

    # --- VISUALIZACIÓN DE RESULTADOS (Fuera del Form Submit para persistencia) ---
    if 'cal_result_df' in st.session_state and not st.session_state['cal_result_df'].empty:
        res_df = st.session_state['cal_result_df']
        # Recuperar variables auxiliares
        cal_vars = st.session_state.get('cal_vars', {'rho_aire': 1.2})
        rho_calc = cal_vars.get('rho_aire', 1.2)
        
        st.divider()
        st.subheader("Resultados de Calibración")
        
        # --- FUNCIÓN GUM PARA 2 CIFRAS SIGNIFICATIVAS ---
        def format_metrologico(val, u, sig_figs=2):
            import math
            import pandas as pd
            if pd.isna(u) or u == 0:
                return f"{val:.4f}", f"{u:.4f}"
            try:
                orden = math.floor(math.log10(abs(u)))
                decimales_matematicos = -orden + (sig_figs - 1)
                
                u_rnd = round(u, decimales_matematicos)
                val_rnd = round(val, decimales_matematicos)
                
                if decimales_matematicos >= 0:
                    fmt = f"{{:.{decimales_matematicos}f}}"
                    return fmt.format(val_rnd), fmt.format(u_rnd)
                else:
                    return f"{val_rnd:.0f}", f"{u_rnd:.0f}"
            except:
                return f"{val:.4f}", f"{u:.4f}"

        # Métricas Globales
        max_error_raw = res_df['Error'].abs().max()
        max_u_raw = res_df['U Exp'].max()
        conformidad_global = "APROBADO" if all(x == "ACEPTADO" for x in res_df['Conformidad']) else "RECHAZADO"
        
        max_error_fmt, max_u_fmt = format_metrologico(max_error_raw, max_u_raw)
        
        kpi1, kpi2, kpi3 = st.columns(3)
        kpi1.metric("Error Máximo", f"{max_error_fmt} {unidad}")
        kpi2.metric("Incertidumbre Máx", f"{max_u_fmt} {unidad}")
        kpi3.metric("Resultado Final", conformidad_global, delta_color="normal" if conformidad_global=="APROBADO" else "inverse")

        # Renombrar columna dinámicamente según método
        metodo_actual = get_persist('metodo_incertidumbre')
        if "Monte Carlo" in metodo_actual:
            lbl_u = "U Exp (Monte Carlo)"
        else:
            lbl_u = "U Exp (GUM)"
            
        res_df_display = res_df.rename(columns={'U Exp': lbl_u}).copy()

        # Aplicar formato a tabla
        def aplicar_formato_fila(row):
            u_val = row[lbl_u]
            err_fmt, u_fmt = format_metrologico(row['Error'], u_val)
            lect_fmt, _ = format_metrologico(row['Lectura Promedio'], u_val)
            ref_fmt, _ = format_metrologico(row['Ref. Corregida'], u_val)
            
            # Formatear nuevas columnas
            if 'M1 (asc)' in row:
                m1_fmt, _ = format_metrologico(row['M1 (asc)'], u_val)
                row['M1 (asc)'] = m1_fmt
            if 'M2 (desc)' in row:
                m2_fmt, _ = format_metrologico(row['M2 (desc)'], u_val)
                row['M2 (desc)'] = m2_fmt
            if 'Histeresis' in row:
                hist_fmt, _ = format_metrologico(row['Histeresis'], u_val)
                row['Histeresis'] = hist_fmt
            
            row['Error'] = err_fmt
            row[lbl_u] = u_fmt
            row['Lectura Promedio'] = lect_fmt
            row['Ref. Corregida'] = ref_fmt
            return row
            
        res_df_display = res_df_display.apply(aplicar_formato_fila, axis=1)

        # Tabla Resultados
        cols_to_show = ['Punto Nominal', 'M1 (asc)', 'M2 (desc)', 'Lectura Promedio', 'Ref. Corregida', 'Error', 'Histeresis', lbl_u, 'Conformidad']
        # Nos aseguramos de que las columnas existan en el dataframe
        existing_cols = [c for c in cols_to_show if c in res_df_display.columns]
        
        st.dataframe(
            res_df_display[existing_cols],
            use_container_width=True,
            hide_index=True
        )
        
        # Gráficas
        st.subheader("Análisis Gráfico")
        tab1, tab2 = st.tabs(["Error vs Presión", "Relación Error/Incertidumbre"])
        
        with tab1:
            fig = px.scatter(
                res_df, x="Punto Nominal", y="Error", 
                error_y="U Exp", 
                title=f"Error de Indicación ({unidad})",
                labels={"Punto Nominal": f"Presión ({unidad})", "Error": f"Error ({unidad})"}
            )
            fig.update_traces(mode='lines+markers')
            emp_val = (clase * rango_max) / 100
            fig.add_hline(y=emp_val, line_dash="dash", line_color="red", annotation_text="EMP (+)")
            fig.add_hline(y=-emp_val, line_dash="dash", line_color="red", annotation_text="EMP (-)")
            st.plotly_chart(fig, use_container_width=True)
        
        with tab2:
            fig2 = go.Figure()
            fig2.add_trace(go.Bar(
                x=res_df['Punto Nominal'], 
                y=res_df['Error'].abs(),
                name='Error Absoluto'
            ))
            fig2.add_trace(go.Scatter(
                x=res_df['Punto Nominal'],
                y=[emp_val] * len(res_df),
                mode='lines',
                name='EMP',
                line=dict(color='red', dash='dash')
            ))
            fig2.update_layout(title="Comparación Error Absoluto vs EMP")
            st.plotly_chart(fig2, use_container_width=True)

        # Detalle de Incertidumbre
        with st.expander("🔎 Ver Detalle de Cálculo de Incertidumbre"):
            st.markdown("### Desglose de Componentes de Incertidumbre")
            st.markdown(f"Todas las unidades están normalizadas a: **{unidad}**")
            
            # Preparar DF de desglose
            cols_detalle = ['Punto Nominal', 'u_rep', 'u_res_inst', 'u_patron', 'u_histe', 'u_zero', 'U Exp']
            df_detalle = res_df[cols_detalle].copy()
            
            # Renombrar columnas para display amigable
            df_detalle.columns = ['Punto', 'u(Rep)', 'u(Res)', 'u(Pat)', 'u(Hist)', 'u(Cero)', 'U Exp']
            
            st.dataframe(df_detalle, use_container_width=True)
            
            st.markdown("---")
            st.markdown("### Parámetros Utilizados")
            
            # Layout: 
            # Col 1: Patrón Principal
            # Col 2: Patrón Secundario (si existe), sino vacío/espacio
            # Col 3: Condiciones Ambientales
            
            c_p1, c_p2, c_p3 = st.columns(3)
            
            with c_p1:
                st.markdown("#### 🔹 Patrón Principal")
                st.write(f"**ID/Alias:** {selected_patron.get('alias')}")
                st.write(f"**Clase:** {selected_patron.get('clase_exactitud')}")
                st.write(f"**Incertidumbre (Orig):** {selected_patron.get('incertidumbre_expandida')} {selected_patron.get('unidad')}")
                st.write(f"**Deriva:** {selected_patron.get('deriva')}")
                st.write(f"**Resolución:** {selected_patron.get('resolucion')} {selected_patron.get('unidad')}")

            with c_p2:
                if selected_patron_aux:
                     st.markdown("#### 🔸 Patrón Secundario")
                     st.write(f"**ID/Alias:** {selected_patron_aux.get('alias')}")
                     st.write(f"**Clase:** {selected_patron_aux.get('clase_exactitud')}")
                     st.write(f"**Incertidumbre (Orig):** {selected_patron_aux.get('incertidumbre_expandida')} {selected_patron_aux.get('unidad')}")
                     st.write(f"**Deriva:** {selected_patron_aux.get('deriva')}")
                     # st.write(f"**Resolución:** ...") # Si se tuviera

            with c_p3:
                st.markdown("#### 🌡️ Condiciones Ambientales")
                st.write(f"**Temp. Lab:** {temp} °C")
                st.write(f"**Densidad Aire:** {rho_calc:.4f} kg/m³")
                st.write(f"**Gravedad:** {g_local} m/s²")
                st.write(f"**Presión Atm:** {p_atm} hPa")

        # Exportar
        csv = res_df.to_csv(index=False).encode('utf-8')
        marca_safe = str(marca).replace(" ", "_") if marca else "manometro"
        
        c_export1, c_export2 = st.columns(2)
        with c_export1:
            st.download_button(
                label="💾 Descargar Informe CSV",
                data=csv,
                file_name=f"calibracion_{marca_safe}_{serie}.csv",
                mime="text/csv"
            )

        st.divider()
        st.subheader("📜 Certificado de Calibración ISO 17025")
        with st.expander("Configurar Datos del Certificado"):
            col_c1, col_c2 = st.columns(2)
            with col_c1:
                id_cert = st.text_input("Número de Certificado", f"CERT-{datetime.date.today().year}-001")
                cliente_nombre = st.text_input("Nombre del Cliente", "")
                contacto_cliente = st.text_input("Contacto (Persona)", "")
                telefono_cliente = st.text_input("Teléfono", "")
            with col_c2:
                direccion_cliente = st.text_input("Dirección del Cliente", "")
                n_contrato = st.text_input("N° de Contrato", "")
                objeto_desc = st.text_input("Objeto (Descripción)", "MANÓMETRO DE PRESIÓN")
                fecha_emision = st.date_input("Fecha de Emisión", datetime.date.today())
                fecha_proxima = st.date_input("Próxima Calibración", datetime.date.today() + datetime.timedelta(days=365))
            
            # Recopilar metadatos
            cert_metadata = {
                "cert_id": id_cert,
                "lugar": get_persist('lugar_calibracion'),
                "cliente": cliente_nombre,
                "direccion": direccion_cliente,
                "contacto": contacto_cliente,
                "telefono": telefono_cliente,
                "contrato": n_contrato,
                "objeto": objeto_desc,
                "fecha": fecha_emision.strftime("%Y-%m-%d"),
                "fecha_proxima": fecha_proxima.strftime("%Y-%m-%d"),
                "fecha_calibracion": get_persist('fecha_calibracion') or datetime.date.today().strftime("%Y-%m-%d"),
                "ubicacion_lab": "Quito, Cumbaya, Psj Lorenzo Ghiberti y Valdivia, 170184",
                "telefono_lab": "(+593) 983431517",
                "email_lab": "gerencia.metrologia@quometer.com",
                "instrumento": {
                    "marca": marca,
                    "modelo": get_persist('modelo'),
                    "serie": serie,
                    "id_interno": get_persist('id_interno'),
                    "clase": clase,
                    "rango_min": rango_min,
                    "rango_max": rango_max,
                    "unidad": unidad,
                    "localizacion": get_persist('ubicacion_instrumento')
                },
                "ambientales": {
                    "temperatura": temp,
                    "humedad": hr,
                    "presion_atm": p_atm
                }
            }
            
            # Preparar Trazabilidad (Patrones principales)
            standards_info = []
            if selected_patron:
                standards_info.append({
                    "nombre": selected_patron.get('alias') or selected_patron.get('_id'),
                    "marca": selected_patron.get('marca', 'N/A'),
                    "modelo": selected_patron.get('modelo', 'N/A'),
                    "codigo": selected_patron.get('_id', 'N/A'),
                    "rango": f"{selected_patron.get('rango_min', 0)} a {selected_patron.get('rango_max', 100)} {selected_patron.get('unidad')}",
                    "certificado": selected_patron.get('certificado', 'N/A'),
                    "vence": selected_patron.get('fecha_vencimiento', 'N/A'),
                    "clase": selected_patron.get('clase_exactitud', 'N/A')
                })
            if selected_patron_aux:
                standards_info.append({
                    "nombre": selected_patron_aux.get('alias') or selected_patron_aux.get('_id'),
                    "marca": selected_patron_aux.get('marca', 'N/A'),
                    "modelo": selected_patron_aux.get('modelo', 'N/A'),
                    "codigo": selected_patron_aux.get('_id', 'N/A'),
                    "rango": f"{selected_patron_aux.get('rango_min', 0)} a {selected_patron_aux.get('rango_max', 100)} {selected_patron_aux.get('unidad')}",
                    "certificado": selected_patron_aux.get('certificado', 'N/A'),
                    "vence": selected_patron_aux.get('fecha_vencimiento', 'N/A')
                })

            # Equipos Auxiliares (Bomba y Termohigrómetro)
            aux_info = []
            if 'selected_bomba_name' in st.session_state.persistent_data:
                name_b = st.session_state.persistent_data['selected_bomba_name']
                if name_b:
                   aux_info.append({"nombre": "BOMBA DE PRESIÓN", "marca": "PMP", "codigo": str(name_b).split('|')[0].strip()})
            
            if 'selected_termo_name' in st.session_state.persistent_data:
                name_t = st.session_state.persistent_data['selected_termo_name']
                if name_t:
                    t_id = str(name_t).split('|')[0].strip()
                    aux_info.append({"nombre": "TERMOHIGRÓMETRO", "codigo": t_id})

            # Pasar EMP
            cert_metadata["emp_val"] = f"{clase * rango_max / 100:.3f}"

            if st.button("🛠️ Generar PDF Certificado"):
                if not cliente_nombre:
                    st.warning("⚠️ Debe ingresar el nombre del cliente.")
                else:
                    try:
                        # Pasar también aux_info
                        pdf_data = create_certificate(cert_metadata, res_df_display.to_dict('records'), standards_info, aux_info)
                        st.download_button(
                            label="⬇️ Descargar Certificado PDF",
                            data=pdf_data,
                            file_name=f"Certificado_{id_cert}.pdf",
                            mime="application/pdf"
                        )
                        st.success("✅ Certificado generado exitosamente.")
                    except Exception as e:
                        st.error(f"Error generando PDF: {e}")
        
        # --- GUARDAR CALIBRACIÓN (ESTADO) ---
        with c_export2:
            if st.button("📁 Guardar Calibración (Sistema)"):
                import json
                import os
                from datetime import datetime
                
                # Crear carpeta si no existe
                if not os.path.exists("calibraciones"):
                    os.makedirs("calibraciones")
                
                # Serializar estado
                estado = {
                    'fecha': datetime.now().isoformat(),
                    'instrumento': {
                        'marca': marca, 'serie': serie, 
                        'rango_min': rango_min, 'rango_max': rango_max, 
                        'unidad': unidad, 'clase': clase, 'resolucion': resolucion,
                        'tipo_indicacion': get_persist('tipo_indicacion'),
                        'tamano': get_persist('tamano'),
                        'fluido': get_persist('fluido'),
                        'lugar_calibracion': get_persist('lugar_calibracion'),
                        'ubicacion': get_persist('ubicacion_instrumento'),
                        'rango_cal_min': get_persist('rango_cal_min'),
                        'rango_cal_max': get_persist('rango_cal_max')
                    },
                    'patron_id': selected_patron.get('_id') if selected_patron else None,
                    'equipos_auxiliares': {
                        'fuente_presion': get_persist('selected_bomba_name'),
                        'termohigrometro': get_persist('selected_termo_name')
                    },
                    'condiciones': {'temp': temp, 'hr': hr, 'p_atm': p_atm, 'h_inst': h_inst, 'h_pat': h_patron, 'g': g_local},
                    'procedimiento': {
                        'precargas_realizadas': get_persist('precargas_ok'),
                        'prueba_hermeticidad_ok': get_persist('prueba_hermeticidad_ok'),
                        'tiempo_estancamiento': get_persist('tiempo_estancamiento'),
                        'estabilizacion_inicio': get_persist('estabilizacion_inicio'),
                        'estabilizacion_fin': get_persist('estabilizacion_fin'),
                        'estado_equipo': get_persist('estado_equipo'),
                        'inspeccion_visual': get_persist('inspeccion_visual')
                    },
                    'puntos': edited_df.to_dict(orient='records'),
                    'resultados_resumen': res_df.to_dict(orient='records')
                }
                
                filename = f"calibraciones/cal_{marca_safe}_{serie}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                with open(filename, 'w', encoding='utf-8') as f:
                    json.dump(estado, f, indent=4)
                
                st.success(f"Calibración guardada en: {filename}")
                # Forzar actualización para que aparezca en historial
                time.sleep(1) # Breve pausa para que el fs se actualice
                st.rerun()

# --- VISTA 2: INVENTARIO ---
elif app_mode == "📋 Inventario de Patrones":
    st.markdown('<div class="main-header">Inventario de Patrones</div>', unsafe_allow_html=True)
    
    if db:
        patrones = obtener_patrones_disponibles(db)
        if patrones:
            # Preparar datos para tabla
            data = []
            for p in patrones:
                # Calcular rango visible
                curva = p.get('curva_calibracion', [])
                r_txt = "N/A"
                if curva:
                    vals = [x['indicacion'] for x in curva]
                    r_txt = f"{min(vals)} a {max(vals)} {p.get('unidad')}"
                
                data.append({
                    'Código': p.get('_id'),
                    'Alias': p.get('alias'),
                    'Marca': p.get('marca'),
                    'Modelo': p.get('modelo'),
                    'Serie': p.get('serie'),
                    'Rango': r_txt,
                    'Clase': p.get('clase_exactitud'),
                    'Fecha Cal.': p.get('fecha_calibracion'),
                    'Certificado': p.get('certificado'),
                    '_obj': p # Guardar objeto completo oculto para detalle
                })
            
            df_inv = pd.DataFrame(data)
            
            # Tabla interactiva con selección
            st.dataframe(
                df_inv.drop(columns=['_obj']),
                use_container_width=True,
                hide_index=True,
                selection_mode="single-row",
                on_select="rerun" # Para futuras versiones de st, o usar st.radio/selectbox
            )
            
            # Selector para ver detalles (Mecanismo alternativo fiable)
            st.divider()
            st.subheader("Detalles del Equipo")
            
            patron_id_ver = st.selectbox("Seleccione un equipo para ver su curva:", df_inv['Código'])
            
            if patron_id_ver:
                # Buscar objeto
                p_obj = next((x['_obj'] for x in data if x['Código'] == patron_id_ver), None)
                
                if p_obj:
                    c1, c2 = st.columns(2)
                    with c1:
                        st.markdown(f"**Marca:** {p_obj.get('marca')} | **Modelo:** {p_obj.get('modelo')}")
                        st.markdown(f"**Serie:** {p_obj.get('serie')}")
                        st.markdown(f"**Certificado:** {p_obj.get('certificado')}")
                    with c2:
                        st.markdown(f"**Clase:** {p_obj.get('clase_exactitud')}")
                        st.markdown(f"**Incertidumbre Máx:** {(p_obj.get('incertidumbre_maxima') or 0.0):.4f}")
                        st.markdown(f"**Deriva:** {(p_obj.get('deriva') or 0.0):.4f}")
                    
                    st.write("**Curva de Calibración:**")
                    curva = p_obj.get('curva_calibracion', [])
                    if curva:
                        df_curva = pd.DataFrame(curva)
                        st.dataframe(df_curva, use_container_width=True)
                        
                        # Graficar curva corrección
                        fig_c = px.line(df_curva, x='indicacion', y='correccion', markers=True, 
                                        title=f"Curva de Corrección ({p_obj.get('unidad')})")
                        st.plotly_chart(fig_c, use_container_width=True)
                    else:
                        st.warning("Este equipo no tiene datos de curva de calibración registrados.")
                    
                    st.divider()
                    
                    # Botón para USAR y volver
                    # Determinar tipo para el mensaje
                    tipo_obj = p_obj.get('tipo', 'manometro')
                    lbl_btn = f"🛠️ Usar este {tipo_obj.capitalize()} en Calibración"
                    
                    if st.button(lbl_btn, type="primary"):
                        alias_safe = p_obj.get('alias') or "Sin Alias"
                        nombre_clave = f"{p_obj.get('_id')} | {alias_safe}"
                        
                        # Setear en persistencia según tipo
                        if tipo_obj == 'manometro':
                            st.session_state.persistent_data['selected_patron_name'] = nombre_clave
                        elif tipo_obj == 'fuente_presion':
                            st.session_state.persistent_data['selected_bomba_name'] = nombre_clave
                        elif tipo_obj == 'termohigrometro':
                             st.session_state.persistent_data['selected_termo_name'] = nombre_clave
                        
                        st.toast(f"Seleccionado: {p_obj.get('_id')}", icon="✅")
                        st.session_state.editor_key += 0 # No-op, just to touch state
                        # Hack para cambiar de pestaña controlando el widget (si fuera posible)
                        # Como st.sidebar.radio no tiene estado escribible fácil sin key, 
                        # confiamos en que el usuario navegue, o usamos un query param...
                        # Por ahora solo feedback visual
                        st.success(f"Equipo seleccionado. Vaya a la pestaña '🛠️ Calibración'.")
        else:
            st.info("No hay patrones registrados en la base de datos.")


# --- VISTA 3: HISTORIAL ---
elif app_mode == "📂 Historial Calibraciones":
    st.markdown('<div class="main-header">Historial de Calibraciones Guardadas</div>', unsafe_allow_html=True)
    import os
    import json
    
    if not os.path.exists("calibraciones"):
        st.info("No hay calibraciones guardadas.")
    else:
        files = [f for f in os.listdir("calibraciones") if f.endswith('.json')]
        if not files:
            st.info("No hay archivos JSON en la carpeta 'calibraciones'.")
        else:
            selected_file = st.selectbox("Seleccionar Archivo:", files)
            if selected_file:
                path = os.path.join("calibraciones", selected_file)
                with open(path, 'r', encoding='utf-8') as f:
                    cal_data = json.load(f)
                
                st.subheader(f"Archivo: {selected_file}")
                # Mostrar resumen clave
                c1, c2 = st.columns(2)
                inst = cal_data.get('instrumento', {})
                cond = cal_data.get('condiciones', {})
                with c1:
                    st.write(f"**Fecha:** {cal_data.get('fecha')}")
                    st.write(f"**Instrumento:** {inst.get('marca')} - {inst.get('serie')}")
                with c2:
                    st.write(f"**Rango:** {inst.get('rango_min')} a {inst.get('rango_max')} {inst.get('unidad')}")
                    st.write(f"**Patrón ID:** {cal_data.get('patron_id')}")
                
                with st.expander("Ver JSON Completo"):
                    st.json(cal_data)
                
                # Botón para cargar (Recuperar estado)
                # Botón para cargar (Recuperar estado)
                if st.button("📥 Cargar esta Calibración", type="primary"):
                    # 1. Recuperar Instrumento
                    st.session_state.persistent_data['marca'] = inst.get('marca', '')
                    st.session_state.persistent_data['serie'] = inst.get('serie', '')
                    st.session_state.persistent_data['rango_min'] = float(inst.get('rango_min', 0.0))
                    st.session_state.persistent_data['rango_max'] = float(inst.get('rango_max', 100.0))
                    st.session_state.persistent_data['unidad'] = inst.get('unidad', 'psi')
                    st.session_state.persistent_data['resolucion'] = float(inst.get('resolucion', 0.1))
                    st.session_state.persistent_data['clase'] = float(inst.get('clase', 1.0))
                    # Nuevos campos
                    st.session_state.persistent_data['tamano'] = inst.get('tamano', '')
                    st.session_state.persistent_data['tipo_indicacion'] = inst.get('tipo_indicacion', 'Analógica')
                    st.session_state.persistent_data['fluido'] = inst.get('fluido', 'Aire')
                    st.session_state.persistent_data['lugar_calibracion'] = inst.get('lugar_calibracion', 'Laboratorio')
                    st.session_state.persistent_data['ubicacion_instrumento'] = inst.get('ubicacion', '')
                    st.session_state.persistent_data['rango_cal_min'] = float(inst.get('rango_cal_min', 0.0))
                    st.session_state.persistent_data['rango_cal_max'] = float(inst.get('rango_cal_max', 100.0))
                    
                    # 2a. Recuperar Condiciones
                    cond = cal_data.get('condiciones', {})
                    st.session_state.persistent_data['temp'] = float(cond.get('temp', 20.0))
                    st.session_state.persistent_data['hr'] = float(cond.get('hr', 50.0))
                    st.session_state.persistent_data['patm'] = float(cond.get('p_atm', 1013.25))
                    st.session_state.persistent_data['h_inst'] = float(cond.get('h_inst', 0.0))
                    st.session_state.persistent_data['h_patron'] = float(cond.get('h_pat', 0.0))
                    st.session_state.persistent_data['g'] = float(cond.get('g', 9.77))
                    
                    # 2b. Recuperar Procedimiento
                    proc = cal_data.get('procedimiento', {})
                    st.session_state.persistent_data['precargas_ok'] = bool(proc.get('precargas_realizadas', False))
                    st.session_state.persistent_data['prueba_hermeticidad_ok'] = bool(proc.get('prueba_hermeticidad_ok', False))
                    st.session_state.persistent_data['tiempo_estancamiento'] = float(proc.get('tiempo_estancamiento', 30.0))
                    st.session_state.persistent_data['estabilizacion_inicio'] = proc.get('estabilizacion_inicio')
                    st.session_state.persistent_data['estabilizacion_fin'] = proc.get('estabilizacion_fin')
                    st.session_state.persistent_data['estado_equipo'] = proc.get('estado_equipo', 'En Servicio')
                    st.session_state.persistent_data['inspeccion_visual'] = proc.get('inspeccion_visual', ['Rosca', 'Dial/Pantalla', 'Carcasa', 'Mica', 'Puntero/Aguja'])
                    
                    # 2c. Recuperar Equipos Auxiliares
                    aux = cal_data.get('equipos_auxiliares', {})
                    if aux.get('fuente_presion'):
                        st.session_state.persistent_data['selected_bomba_name'] = aux.get('fuente_presion')
                    if aux.get('termohigrometro'):
                        st.session_state.persistent_data['selected_termo_name'] = aux.get('termohigrometro')

                    # 3. Recuperar Patrón
                    pat_id = cal_data.get('patron_id')
                    if pat_id and db:
                        # Buscar el nombre completo "ID | Alias"
                        # Esto es ineficiente pero seguro
                        all_pats = obtener_patrones_disponibles(db)
                        for p in all_pats:
                            if p.get('_id') == pat_id:
                                alias_safe = p.get('alias') or "Sin Alias"
                                full_name = f"{p.get('_id')} | {alias_safe}"
                                st.session_state.persistent_data['selected_patron_name'] = full_name
                                break

                    # 4. Recuperar Puntos
                    puntos_raw = cal_data.get('puntos', [])
                    if puntos_raw:
                        st.session_state.puntos_df = pd.DataFrame(puntos_raw)
                        # Limpiar editor para que lea del df
                        if 'editor_data' in st.session_state: del st.session_state['editor_data']
                        st.session_state.editor_key += 1
                    
                    st.toast("Calibración cargada exitosamente.", icon="✅")
                    st.success("Datos recuperados. Ve a la pestaña '🛠️ Calibración' para continuar.")
                    # st.rerun() # Opcional si se quiere ir directo, pero mejor dejar que el usuario vea el mensaje
                    
                    st.toast("Calibración cargada exitosamente.", icon="✅")
                    st.success("Datos recuperados. Ve a la pestaña '🛠️ Calibración' para continuar.")


