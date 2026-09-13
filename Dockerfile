# Multi-stage build for minimal final image
FROM nginx:alpine

# Provenance build args — the fleet-canonical names (repo.dockerfile_provenance_args). An image
# whose revision cannot be traced to a commit is unauditable after the fact.
ARG BUILD_VERSION=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_TIMESTAMP=unknown

# OCI standard labels (repo.oci_image_labels) — version/created/revision are what `docker inspect`
# and every scanner read. The app.* labels stay as a convenience for anything already keyed on them.
LABEL org.opencontainers.image.title="luxmark" \
      org.opencontainers.image.description="Premium browser-based markdown editor with live preview" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_COMMIT}" \
      org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.source="https://github.com/luxardolabs/luxmark" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      maintainer="luxardolabs" \
      app.name="luxmark" \
      app.version="${BUILD_VERSION}"

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
  \"version\": \"${BUILD_VERSION}\", \
  \"buildTimestamp\": \"${BUILD_TIMESTAMP}\", \
  \"commit\": \"${BUILD_COMMIT}\" \
}" > /usr/share/nginx/html/version.json

# Set environment variables for runtime
ENV APP_VERSION=${BUILD_VERSION} \
    APP_COMMIT=${BUILD_COMMIT} \
    APP_BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

# Create necessary directories and set permissions
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run && \
    chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /var/run && \
    chmod -R 755 /usr/share/nginx/html

# Run as non-root user
USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
