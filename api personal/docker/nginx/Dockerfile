# docker/nginx/Dockerfile
FROM nginx:alpine

RUN apk add --no-cache openssl

# Crear certificados SSL self-signed (solo para desarrollo)
RUN mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/key.pem \
    -out /etc/nginx/ssl/cert.pem \
    -subj "/C=AR/ST=BA/L=CABA/O=PersonalV5/CN=api.personalv5.com"

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]