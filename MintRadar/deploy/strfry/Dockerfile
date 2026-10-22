# strfry nostr relay for MintRadar's own backup relay (wss://nostr.mintradar.org).
# Builds strfry from source (no Debian/apt package exists) inside an Alpine builder,
# then ships a minimal runtime image. Pinned to a tagged release for reproducibility.
ARG STRFRY_REF=1.1.3

FROM alpine:3.24 AS build

WORKDIR /build

RUN apk --no-cache add \
    linux-headers \
    git \
    g++ \
    make \
    perl \
    pkgconfig \
    libtool \
    ca-certificates \
    openssl-dev \
    zlib-dev \
    lmdb-dev \
    flatbuffers-dev \
    libsecp256k1-dev \
    zstd-dev

ARG STRFRY_REF
RUN git clone --branch "${STRFRY_REF}" --depth 1 https://github.com/hoytech/strfry.git . \
    && git submodule update --init --depth 1

RUN make setup-golpe
RUN make -j"$(nproc)"

FROM alpine:3.24

WORKDIR /app

# libssl3/libcrypto3 are the runtime counterparts of the openssl-dev the binary
# is linked against in the build stage (same OpenSSL 3.x series, same sonames).
RUN apk --no-cache add \
    lmdb \
    flatbuffers \
    libsecp256k1 \
    libb2 \
    zstd \
    libssl3 \
    libcrypto3 \
    jq \
  && rm -rf /var/cache/apk/*

# Non-root runtime user — writePolicy plugin and LMDB data dir run as this user.
RUN adduser -D -h /app -s /bin/sh strfry \
    && mkdir -p /app/strfry-db /app/plugins \
    && chown -R strfry:strfry /app

USER strfry

COPY --from=build --chown=strfry:strfry /build/strfry /app/strfry

EXPOSE 7777

ENTRYPOINT ["/app/strfry"]
CMD ["relay"]
