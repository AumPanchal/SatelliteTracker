export default async function handler(req, res) {
    const response = await fetch(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
    );
    const data = await response.text();
    res.status(200).send(data);
  }