from fpdf import FPDF
import datetime
import math
import os
import tempfile
import matplotlib.pyplot as plt
import numpy as np

class CertificateGenerator(FPDF):
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=15)
        self.set_font("Arial", size=10)
        
    def fmt_val(self, val):
        """Helper to avoid 'None' or empty values in the PDF"""
        if val is None or str(val).lower() == 'none' or str(val).strip() == '':
            return "---"
        return str(val)

    def header(self):
        self.set_font("Arial", "B", 10)
        self.set_text_color(30, 58, 138)
        self.set_font("Arial", "B", 16)
        self.cell(40, 10, "QUOMETER", ln=False)
        self.set_text_color(0, 0, 0)
        self.set_font("Arial", "B", 10)
        self.cell(0, 10, f"Pág: {self.page_no()}/{{nb}}", align="R", ln=True)
        
        if hasattr(self, 'current_cert_id'):
            self.set_y(15)
            self.set_font("Arial", "B", 10)
            self.cell(0, 10, self.fmt_val(self.current_cert_id), align="R", ln=True)
        self.ln(5)

    def footer(self):
        self.set_y(-20)
        self.set_font("Arial", size=7)
        line1 = "Dirección: Quito, Cumbaya, Psj Lorenzo Ghiberti y Valdivia, 170184 - Teléfono: (+593) 983431517  (+593) 963783980"
        line2 = "gerencia.metrologia@quometer.com direccion.tecnica@quometer.com"
        self.cell(0, 3, line1, align="C", ln=True)
        self.cell(0, 3, line2, align="C", ln=True)

    def draw_section_header(self, title):
        self.ln(2)
        self.set_font("Arial", "B", 10)
        self.set_fill_color(30, 58, 138)
        self.set_text_color(255, 255, 255)
        self.cell(0, 6, str(title).upper(), ln=True, align="C", fill=True)
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def draw_field_bilingual(self, label_es, label_en, value, w_label=55):
        start_x = self.get_x()
        start_y = self.get_y()
        self.set_font("Arial", "B", 9)
        self.cell(w_label, 4, f"{label_es}:", ln=False)
        self.set_font("Arial", "", 9)
        val_str = self.fmt_val(value)
        self.multi_cell(0, 4, val_str)
        end_y = self.get_y()
        self.set_xy(start_x, start_y + 4)
        self.set_font("Arial", "I", 7)
        self.cell(w_label, 3, label_en, ln=True)
        self.set_y(max(end_y, self.get_y() + 1))

    def generate_cover_page(self, metadata):
        self.current_cert_id = metadata.get("cert_id", "QM-XXXXXX")
        self.add_page()
        self.ln(5)
        self.set_font("Arial", "B", 16)
        self.cell(0, 7, "CERTIFICADO DE CALIBRACIÓN", ln=True, align="C")
        self.set_font("Arial", "I", 10)
        self.cell(0, 5, "Calibration Certificate", ln=True, align="C")
        self.ln(8)

        self.draw_section_header("Datos Generales / General Information")
        self.draw_field_bilingual("Cliente", "Customer", metadata.get("cliente"))
        self.draw_field_bilingual("Dirección Fiscal", "Legal Address", metadata.get("direccion"))
        self.draw_field_bilingual("Contacto", "Contact", metadata.get("contacto"))
        self.draw_field_bilingual("Teléfono", "Phone", metadata.get("telefono"))
        self.draw_field_bilingual("N° de Contrato", "Contract Number", metadata.get("contrato"))

        self.draw_section_header("Datos del Instrumento / Instrument Information")
        inst = metadata.get("instrumento", {})
        y_inst_start = self.get_y()
        w_left = 100
        self.draw_field_bilingual("Objeto", "Object", metadata.get("objeto", "MANÓMETRO"), w_label=40)
        self.draw_field_bilingual("Fabricante / Marca", "Manufacturer / Brand", inst.get("marca"), w_label=40)
        self.draw_field_bilingual("Modelo / Tipo", "Model / Type", inst.get("modelo"), w_label=40)
        self.draw_field_bilingual("Serial", "Serial number", inst.get("serie"), w_label=40)
        self.draw_field_bilingual("Código / Tag", "Code / Tag", inst.get("id_interno"), w_label=40)
        self.draw_field_bilingual("Localización", "Location", inst.get("localizacion"), w_label=40)
        y_inst_end = self.get_y()
        
        self.set_xy(w_left + 10, y_inst_start)
        self.set_font("Arial", "", 8)
        msg_es = "Este certificado de calibración proporciona evidencia documental para la trazabilidad a los patrones nacionales, llevados a cabo par las unidades de medición de acuerdo con el Sistema Internacional de Unidades (SI)."
        msg_en = "This calibration certificate provides documentary evidence for the traceability to national standards, carried out by the units of measurement according to the International System of Units (SI)."
        self.multi_cell(0, 4, f"{msg_es}\n\n{msg_en}")
        self.set_y(max(y_inst_end, self.get_y()) + 5)

        self.draw_field_bilingual("Fecha de Recepción", "Date of Receipt", metadata.get("fecha_recepcion", metadata.get("fecha")))
        self.draw_field_bilingual("Fecha de Emisión", "Issue Date", metadata.get("fecha"))
        self.draw_field_bilingual("Fecha de Calibración", "Calibration date", metadata.get("fecha_calibracion"))
        self.draw_field_bilingual("Fecha Próx. Calibración", "Next Calibration Date", metadata.get("fecha_proxima"))
        self.ln(5)

        self.set_fill_color(240, 240, 240)
        self.set_font("Arial", "B", 10)
        self.cell(0, 6, "QUOMETER", ln=True, align="C", fill=True)
        self.set_font("Arial", "", 7)
        legal_es = "Este certificado es aplicable únicamente al ítem identificado y a las mediciones obtenidas en el momento de la calibración, bajo las condiciones ambientales específicas. El laboratorio no se responsabiliza por la información proporcionada por el cliente. Es responsabilidad del usuario determinar la frecuencia de calibración de cada instrumento. Esta declaración no es auditable en el sistema de gestión de su empresa."
        legal_en = "This certificate applies solely to the identified item and the measurements obtained at the time of calibration, under specific environmental conditions. The laboratory is not responsible for information provided by the customer. It is the user's responsibility to determine the calibration frequency of each instrument."
        self.multi_cell(0, 3, f"{legal_es}\n\n{legal_en}", border=1)
        self.ln(10)

        w_sig = 80
        curr_y = self.get_y()
        self.set_x(self.w - w_sig - 15)
        self.line(self.get_x(), curr_y + 10, self.get_x() + w_sig, curr_y + 10)
        self.set_y(curr_y + 11)
        self.set_font("Arial", "B", 10)
        self.cell(0, 5, "Ing. Edgar Colmenarez", align="C", ln=True)
        self.set_font("Arial", "", 8)
        self.cell(0, 4, "Técnico de Calibración", align="C", ln=True)
        
        self.ln(10)
        curr_y = self.get_y()
        self.set_x(self.w - w_sig - 15)
        self.line(self.get_x(), curr_y + 10, self.get_x() + w_sig, curr_y + 10)
        self.set_y(curr_y + 11)
        self.set_font("Arial", "B", 10)
        self.cell(0, 5, "Ing. Edgar Colmenarez", align="C", ln=True)
        self.set_font("Arial", "", 8)
        self.cell(0, 4, "Gerente Técnico / Autorizado por:", align="C", ln=True)

    def generate_chart(self, results, inst_data, emp_val):
        """Genera el gráfico de calibración usando matplotlib y lo retorna como path temporal"""
        try:
            x_ref = [float(row.get("Punto Nominal", 0)) for row in results]
            y_err = [float(row.get("Error", 0)) for row in results]
            
            u_vals = []
            for row in results:
                uv = row.get("U Exp", 0)
                if uv is None:
                    for k in row.keys():
                        if k.startswith("U Exp"): uv = row[k]; break
                try: u_vals.append(float(uv))
                except: u_vals.append(0)

            emp_abs = float(emp_val) if emp_val else 0

            plt.figure(figsize=(8, 4))
            # Puntos y barras de error
            plt.errorbar(x_ref, y_err, yerr=u_vals, fmt='o', color='#00adef', label='Lec. Prom.', capsize=3)
            # Líneas de EMP
            plt.axhline(y=emp_abs, color='#c00000', linestyle='-', linewidth=1.5, label='EMP (+)')
            plt.axhline(y=-emp_abs, color='#70ad47', linestyle='-', linewidth=1.5, label='EMP (-)')
            # Línea de tendencia (Lineal)
            if len(x_ref) > 1:
                z = np.polyfit(x_ref, y_err, 1)
                p = np.poly1d(z)
                plt.plot(x_ref, p(x_ref), "b:", label=f"Lineal (Trend)")

            plt.title("Resultados de Calibración", fontsize=12)
            plt.xlabel(f"Lecturas de Referencia {inst_data.get('unidad', '')}", fontsize=10)
            plt.ylabel(f"Corrección +/- Incertidumbre", fontsize=10)
            plt.grid(True, linestyle='--', alpha=0.7)
            plt.legend(loc='upper left', bbox_to_anchor=(1, 1), fontsize=8)
            plt.tight_layout()

            temp_dir = tempfile.gettempdir()
            chart_path = os.path.join(temp_dir, f"chart_{datetime.datetime.now().timestamp()}.png")
            plt.savefig(chart_path, dpi=150)
            plt.close()
            return chart_path
        except Exception as e:
            print(f"Error generando gráfico: {e}")
            return None

    def generate_results_page(self, metadata, results, standards, aux_standards):
        self.add_page()
        self.set_font("Arial", "B", 11)
        self.cell(0, 8, "INFORME DE RESULTADOS / RESULTS REPORT", ln=True, align="C")
        self.ln(2)

        # Procedimiento
        self.set_font("Arial", "B", 9)
        self.cell(0, 5, "Procedimiento de Calibración / Calibration Procedure:", ln=True)
        self.set_font("Arial", "", 8)
        proc = "Calibración por comparación directa con patrón, según DKD-R 6-1 (Ed. 03/2014). Secuencia 'C'."
        self.multi_cell(0, 4, proc)
        self.ln(2)
        
        # Ambientales
        env = metadata.get("ambientales", {})
        self.set_font("Arial", "B", 9)
        self.cell(40, 5, "Lugar de Calibración:", ln=False)
        self.set_font("Arial", "", 9)
        self.cell(0, 5, self.fmt_val(metadata.get("lugar", "Laboratorio")), ln=True)
        
        self.set_font("Arial", "B", 9)
        self.cell(40, 5, "Condiciones ambientales:", ln=False)
        self.set_font("Arial", "", 9)
        temp = self.fmt_val(env.get('temperatura'))
        hum = self.fmt_val(env.get('humedad'))
        self.cell(0, 5, f"Temperatura: {temp} °C    Humedad Relativa: {hum} %", ln=True)
        self.ln(2)

        # Tabla Resumen Ítem
        self.draw_section_header("Datos del Ítem Calibrado / Calibrated Item Data")
        inst = metadata.get("instrumento", {})
        self.set_font("Arial", "B", 8)
        self.cell(25, 4, "Instrumento:"); self.set_font("Arial", "", 8); self.cell(55, 4, self.fmt_val(metadata.get("objeto"))); 
        self.set_font("Arial", "B", 8); self.cell(30, 4, "Medio Prueba:"); self.set_font("Arial", "", 8); self.cell(0, 4, self.fmt_val(inst.get("fluido", "Aceite")), ln=True)
        
        self.set_font("Arial", "B", 8)
        self.cell(25, 4, "Marca:"); self.set_font("Arial", "", 8); self.cell(55, 4, self.fmt_val(inst.get("marca"))); 
        self.set_font("Arial", "B", 8); self.cell(30, 4, "Resolución:"); self.set_font("Arial", "", 8); self.cell(0, 4, self.fmt_val(inst.get("resolucion")), ln=True)
        
        self.set_font("Arial", "B", 8)
        self.cell(25, 4, "Modelo:"); self.set_font("Arial", "", 8); self.cell(55, 4, self.fmt_val(inst.get("modelo")));
        self.set_font("Arial", "B", 8); self.cell(30, 4, "Exactitud:"); self.set_font("Arial", "", 8)
        clase_val = self.fmt_val(inst.get('clase'))
        self.cell(0, 4, f"{clase_val}%" if clase_val != "---" else "---", ln=True)
        
        self.set_font("Arial", "B", 8)
        self.cell(25, 4, "Serie:"); self.set_font("Arial", "", 8); self.cell(55, 4, self.fmt_val(inst.get("serie")));
        self.ln(2)

        # Trazabilidad
        self.draw_section_header("Trazabilidad / Traceability")
        tw = [35, 25, 20, 25, 25, 30, 25]
        heads = ["Descripción", "Marca", "Modelo", "Código", "Rango", "Certificado", "Vence"]
        self.set_font("Arial", "B", 7)
        for i, h in enumerate(heads):
            self.cell(tw[i], 5, h, border=1, align="C")
        self.ln()
        self.set_font("Arial", "", 7)
        for s in standards:
            self.cell(tw[0], 5, self.fmt_val(s.get('nombre')), border=1)
            self.cell(tw[1], 5, self.fmt_val(s.get('marca')), border=1)
            self.cell(tw[2], 5, self.fmt_val(s.get('modelo')), border=1)
            self.cell(tw[3], 5, self.fmt_val(s.get('codigo')), border=1)
            self.cell(tw[4], 5, self.fmt_val(s.get('rango')), border=1)
            self.cell(tw[5], 5, self.fmt_val(s.get('certificado')), border=1)
            self.cell(tw[6], 5, self.fmt_val(s.get('vence')), border=1)
            self.ln()
        self.ln(2)

        # Equipos Auxiliares
        self.draw_section_header("Equipos Auxiliares / Auxiliary Equipment")
        self.set_font("Arial", "B", 7)
        for i, h in enumerate(heads):
            self.cell(tw[i], 5, h, border=1, align="C")
        self.ln()
        self.set_font("Arial", "", 7)
        if not aux_standards:
             self.cell(sum(tw), 5, "Ninguno", border=1, align="C", ln=True)
        else:
            for a in aux_standards:
                 self.cell(tw[0], 5, self.fmt_val(a.get('nombre')), border=1)
                 self.cell(tw[1], 5, self.fmt_val(a.get('marca')), border=1)
                 self.cell(tw[2], 5, self.fmt_val(a.get('modelo')), border=1)
                 self.cell(tw[3], 5, self.fmt_val(a.get('codigo')), border=1)
                 self.cell(tw[4], 5, self.fmt_val(a.get('rango')), border=1)
                 self.cell(tw[5], 5, self.fmt_val(a.get('certificado')), border=1)
                 self.cell(tw[6], 5, self.fmt_val(a.get('vence')), border=1)
                 self.ln()
        self.ln(2)

        # Resultados
        self.draw_section_header("Resultados / Results")
        w_nom = 22
        w_lect = 38
        w_prom = 22
        w_err = 22
        w_hist = 22
        w_u = 26
        w_conf = 16
        
        y0 = self.get_y()
        mx = self.l_margin
        self.set_font("Arial", "B", 8)
        
        # Fila 1 y 2 combinadas para columnas simples
        self.set_xy(mx, y0)
        self.cell(w_nom, 10, "Presión", border=1, align="C")
        
        # Columna combinada "Lecturas"
        self.set_xy(mx + w_nom, y0)
        self.cell(w_lect, 5, "Lecturas en el objeto", border=1, align="C")
        self.set_xy(mx + w_nom, y0 + 5)
        self.set_font("Arial", "B", 7)
        self.cell(w_lect/2, 5, "M1 (asc)", border=1, align="C")
        self.cell(w_lect/2, 5, "M2 (desc)", border=1, align="C")
        
        # Resto de columnas (2 filas de alto)
        self.set_font("Arial", "B", 8)
        self.set_xy(mx + w_nom + w_lect, y0)
        self.cell(w_prom, 10, "Valor medio", border=1, align="C")
        self.cell(w_err, 10, "Error", border=1, align="C")
        self.cell(w_hist, 10, "Histéresis", border=1, align="C")
        self.cell(w_u, 10, "U expandida", border=1, align="C")
        self.cell(w_conf, 10, "Conf.", border=1, align="C")
        
        self.set_y(y0 + 10)
        self.set_font("Arial", "", 7)
        max_u = 0
        max_err = 0
        for row in results:
            u_val = row.get("U Exp")
            if u_val is None:
                for k in row.keys():
                    if k.startswith("U Exp"): u_val = row[k]; break
            try:
                max_u = max(max_u, float(u_val))
                max_err = max(max_err, abs(float(row.get("Error", 0))))
            except: pass

            self.cell(w_nom, 5, self.fmt_val(row.get("Punto Nominal")), border=1, align="C")
            self.cell(w_lect/2, 5, self.fmt_val(row.get("M1 (asc)")), border=1, align="C")
            self.cell(w_lect/2, 5, self.fmt_val(row.get("M2 (desc)")), border=1, align="C")
            self.cell(w_prom, 5, self.fmt_val(row.get("Lectura Promedio")), border=1, align="C")
            self.cell(w_err, 5, self.fmt_val(row.get("Error")), border=1, align="C")
            self.cell(w_hist, 5, self.fmt_val(row.get("Histeresis", "0")), border=1, align="C")
            self.cell(w_u, 5, self.fmt_val(u_val), border=1, align="C")
            conform = "OK" if "ACEPTADO" in str(row.get("Conformidad","")) else "X"
            self.cell(w_conf, 5, conform, border=1, align="C")
            self.ln()

        self.ln(2)
        unidad = inst.get('unidad', '')
        emp_val_str = self.fmt_val(metadata.get('emp_val'))
        self.set_font("Arial", "B", 9)
        self.cell(85, 5, f"Incertidumbre Expandida Máxima:   {max_u}   {unidad}")
        self.set_text_color(192, 0, 0) # Rojo para EMP como en la referencia
        self.cell(0, 5, f"Error Máximo Permitido:   {emp_val_str}   {unidad}", ln=True)
        self.set_text_color(0, 0, 0)
        
        # 4. Sección de NOTAS
        self.ln(2)
        self.set_font("Arial", "B", 9)
        self.cell(0, 5, "Notas:", ln=True)
        self.set_font("Arial", "", 8)
        self.multi_cell(0, 4, f"Incertidumbre Máxima Expandida, con un nivel de confianza aproximado del 95.45% y un factor de cobertura aproximado de k=2.")
        
        # Conversión a MPa (Dinámica)
        fact_mpa = 0.1 # Default para bar
        if "psi" in unidad.lower(): fact_mpa = 0.00689476
        elif "kg" in unidad.lower(): fact_mpa = 0.0980665
        
        self.cell(0, 4, f"Factor de Conversión a MPa:    1  {unidad}    ->    {fact_mpa:.4f}  MPa", ln=True)
        self.cell(0, 4, f"El cliente ha solicitado se le aplique la regla de decisión, por lo que se informa la conformidad con un OK cuando cumple, X cuando no cumple.", ln=True)
        
        # 5. GRÁFICO
        c_path = self.generate_chart(results, inst, metadata.get('emp_val'))
        if c_path and os.path.exists(c_path):
            self.ln(2)
            # Centrar imagen (Ancho página ~190, Ancho imagen 140)
            self.image(c_path, x=(self.w - 140)/2, w=140)
            try: os.remove(c_path) # Limpieza
            except: pass

    def generate(self, metadata, results, standards, aux_standards):
        self.generate_cover_page(metadata)
        self.generate_results_page(metadata, results, standards, aux_standards)
        return bytes(self.output())

def create_certificate(metadata, results, standards, aux_standards=[]):
    pdf = CertificateGenerator()
    pdf.alias_nb_pages()
    return pdf.generate(metadata, results, standards, aux_standards)
