# Сборка контейнера:  docker build -t gost-scheme .
# Запуск:             docker run -d -p 8080:8080 gost-scheme
# Сайт откроется по адресу http://localhost:8080

# Этап 1: проверка и сборка страницы из исходников
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm test && npm run build

# Этап 2: только статические файлы, nginx без прав root
FROM nginxinc/nginx-unprivileged:alpine
COPY nginx.conf.example /etc/nginx/conf.d/default.conf
COPY --from=build /app/index.html /usr/share/nginx/html/index.html
COPY --from=build /app/fonts/ /usr/share/nginx/html/fonts/
COPY --from=build /app/vendor/ /usr/share/nginx/html/vendor/
EXPOSE 8080
