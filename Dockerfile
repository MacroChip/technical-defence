FROM nginx:alpine

# Serve the static game on port 8082
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css game.js /usr/share/nginx/html/

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8082/ >/dev/null 2>&1 || exit 1
