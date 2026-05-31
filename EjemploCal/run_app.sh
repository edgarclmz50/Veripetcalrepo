#!/bin/bash
# Script para ejecutar la App de Calibración en Linux

echo "Iniciando App de Calibración..."
if [ -f ".venv/bin/streamlit" ]; then
    .venv/bin/streamlit run app.py
else
    echo "Error: No se encontró streamlit en el entorno virtual .venv"
    echo "Asegúrese de haber instalado las dependencias."
    exit 1
fi
