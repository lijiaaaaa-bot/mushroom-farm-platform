# 本地构建对象存储。二进制是 GitHub Release 的 linux 包，sha256 对上才装入镜像。
FROM debian:bookworm-slim

ARG TARGETARCH
ARG SILO_TAG=RELEASE.2026-09-16T00-00-00Z
ARG SILO_VERSION=20260916000000.0.0

RUN set -eu \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && arch="${TARGETARCH:-amd64}" \
  && case "$arch" in \
       amd64) file="silo_${SILO_VERSION}_linux_amd64.tar.gz"; sum="381e745510a8fb64323d7bb3207f95984b7f4ed826f4fcad318f97683c420c73" ;; \
       arm64) file="silo_${SILO_VERSION}_linux_arm64.tar.gz"; sum="6e697d3e1d70f2343fe829cd6820a0b840d4619f1dde546424de80e529636ed2" ;; \
       *) echo "不支持的架构: $arch" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o "/tmp/${file}" "https://github.com/pgsty/silo/releases/download/${SILO_TAG}/${file}" \
  && echo "${sum}  /tmp/${file}" | sha256sum -c - \
  && tar -xzf "/tmp/${file}" -C /usr/local/bin silo \
  && chmod 755 /usr/local/bin/silo \
  && rm -f "/tmp/${file}"

COPY entrypoint.sh /usr/local/bin/object-store-entrypoint
RUN chmod 755 /usr/local/bin/object-store-entrypoint
ENTRYPOINT ["/usr/local/bin/object-store-entrypoint"]
