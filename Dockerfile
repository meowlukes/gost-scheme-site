# Сборка контейнера:  docker build -t gost-scheme .
# Запуск:             docker run -d -p 8080:80 gost-scheme
# Сайт откроется по адресу http://localhost:8080
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY fonts/ /usr/share/nginx/html/fonts/
COPY vendor/ /usr/share/nginx/html/vendor/
