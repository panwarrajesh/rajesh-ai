"""Copy to custom_gpt_adapter.py and wire in your own model."""

_model = None
_tokenizer = None


def load():
    global _model, _tokenizer
    # import torch
    # from my_gpt import GPT, Tokenizer
    # _model = GPT(...); _model.load_state_dict(torch.load("weights.pt")); _model.eval()
    # _tokenizer = Tokenizer(...)
    raise NotImplementedError("Load your model here.")


def generate(prompt: str, temperature: float):
    """Yield text pieces (token by token) as your model generates them."""
    raise NotImplementedError("Yield generated text here.")
