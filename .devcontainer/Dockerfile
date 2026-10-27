FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

# This base image ships with an apt source for Yarn whose signing key is no
# longer valid. Any "apt-get update" then fails, which breaks the
# docker-in-docker feature install. Yarn is not needed here, so remove it.
RUN grep -rl "yarnpkg" /etc/apt/sources.list.d/ 2>/dev/null | xargs -r rm -f
