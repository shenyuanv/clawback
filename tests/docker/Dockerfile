FROM node:22-slim

# Install system dependencies required by openclaw
RUN apt-get update && apt-get install -y --no-install-recommends \
    git procps python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Rewrite git+ssh:// URLs to git+https:// so npm can fetch without SSH keys
# Each insteadOf pattern needs a unique URL section, but both map to https
RUN git config --global --add url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global --add url."https://github.com/".insteadOf "git@github.com:"

# Install saddlebag from the local tarball + openclaw for gateway boot test
COPY saddlebag-*.tgz /tmp/
RUN npm install -g /tmp/saddlebag-*.tgz && npm install -g openclaw && rm /tmp/saddlebag-*.tgz

# Copy the test backup archive and source paths for verification
COPY test-backup.saddlebag /tmp/test-backup.saddlebag
COPY .source-workspace-path /tmp/.source-workspace-path

# Copy the verification script
COPY verify-restore.sh /usr/local/bin/verify-restore.sh
RUN chmod +x /usr/local/bin/verify-restore.sh

CMD ["bash", "/usr/local/bin/verify-restore.sh"]
