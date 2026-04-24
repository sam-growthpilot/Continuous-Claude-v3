FROM python:3.11-slim

RUN useradd -m -u 1000 sandbox
USER sandbox
WORKDIR /home/sandbox

RUN pip install --user --no-cache-dir \
    dill==0.3.8 \
    regex==2024.11.6

ENV PATH="/home/sandbox/.local/bin:${PATH}"

CMD ["python", "-u"]
