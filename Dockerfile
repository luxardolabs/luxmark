# Multi-stage build for minimal final image
FROM nginx:alpine

# Build arguments
ARG VERSION=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_DATE=unknown

# Labels for metadata
LABEL maintainer="luxardolabs" \
      app.name="luxmark" \
      app.version="${VERSION}" \
      app.build.date="${BUILD_DATE}" \
      app.build.timestamp="${BUILD_TIMESTAMP}" \
      app.description="Premium browser-based markdown editor with live preview"

# Add security headers and configurations
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx configurations
COPY docker/nginx-main.conf /etc/nginx/nginx.conf
COPY docker/nginx.conf /etc/nginx/conf.d/

# Copy static files
COPY src/index.html /usr/share/nginx/html/
COPY src/favicon.ico /usr/share/nginx/html/
COPY src/css/ /usr/share/nginx/html/css/
COPY src/js/ /usr/share/nginx/html/js/
COPY src/images/ /usr/share/nginx/html/images/
COPY src/welcome-to-luxmark.md /usr/share/nginx/html/

# Create version file with build information
RUN echo "{ \
  \"app\": \"luxmark\", \
  \"version\": \"${VERSION}\", \
  \"buildDate\": \"${BUILD_DATE}\", \
  \"buildTimestamp\": \"${BUILD_TIMESTAMP}\", \
  \"git\": { \
    \"branch\": \"main\", \
    \"commit\": \"n/a\" \
  } \
}" > /usr/share/nginx/html/version.json

# Set environment variables for runtime
ENV APP_VERSION=${VERSION} \
    APP_BUILD_DATE=${BUILD_DATE} \
    APP_BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

# Create necessary directories and set permissions
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run && \
    chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /var/run && \
    chmod -R 755 /usr/share/nginx/html

# Run as non-root user
USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
