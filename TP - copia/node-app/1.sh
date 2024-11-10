#!/bin/bash

# Nombre del archivo de salida
output_file="unificado.txt"

# Limpiar el archivo de salida antes de escribir
echo "" > "$output_file"

# Función que verifica si el archivo está en node_modules
is_in_node_modules() {
  [[ $1 == *"node_modules"* ]]
}

# Función para procesar los archivos en un directorio
process_files_in_directory() {
  local dir="$1"
  
  # Buscar todos los archivos .txt, .ejs, y .js en el directorio
  find "$dir" -type f \( -name "*.txt" -o -name "*.ejs" -o -name "*.js" \) | while read -r file; do
    if ! is_in_node_modules "$file"; then
      echo "Procesando archivo: $file"
      
      # Leer el contenido del archivo
      content=$(cat "$file")
      
      # Obtener el nombre de la carpeta donde está el archivo
      folder=$(dirname "$file")

      # Escribir los datos en el archivo de salida
      echo "===== Archivo: $file =====" >> "$output_file"
      echo "Carpeta: $folder" >> "$output_file"
      echo "Contenido:" >> "$output_file"
      echo "$content" >> "$output_file"
      echo -e "\n\n" >> "$output_file" # Agregar una separación entre archivos
    else
      echo "Saltando archivo en node_modules: $file"
    fi
  done
}

# Directorio base (puedes cambiar esto según lo que necesites)
base_dir="."

# Procesar archivos en el directorio base
process_files_in_directory "$base_dir"

echo "Unificación completa. El archivo de salida es $output_file"
