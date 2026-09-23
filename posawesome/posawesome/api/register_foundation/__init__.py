"""Spec 01 — POS Store / POS Register foundation.

Layers: ``model`` (pure rules) → ``errors``/``scope``/``receipts``/``events``
(Frappe primitives) → ``routing``/``runtime`` (money and ownership) →
``commands``/``queries`` (whitelisted protocol) → ``migration`` (dry run).
"""
