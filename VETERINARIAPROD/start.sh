#!/usr/bin/env bash
# Levanta el proyecto ignorando variables del sistema que colisionan con .env
# MYSQL_HOST del sistema apunta a 127.0.0.1 (para otros proyectos),
# por eso la desactivamos solo para este proceso de Docker Compose.
env -u MYSQL_HOST docker compose "$@"
