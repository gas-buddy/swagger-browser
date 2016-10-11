FROM gasbuddy/node-app:6-onbuild

ONBUILD cd /data/swagger-ui && \
    npm install && \
    npm run build && \
    rm -rf node_modules

EXPOSE 8080